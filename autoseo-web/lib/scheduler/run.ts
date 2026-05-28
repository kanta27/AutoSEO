// Shared scheduler library. Two entry points use this:
//   - POST /api/scheduler/run     (cron-facing, secret-gated, RESPECTS due-logic)
//   - POST /api/scheduler/run-now (dashboard button, same-origin, IGNORES due-logic)
//
// Resilience contract:
//   - One company failing must not stop others.
//   - One runner failing (within a company) must not stop other runners.
//   - Every attempt is recorded in `agent_runs` — success or failure.
//   - We never throw out of runAllDue; all errors are folded into the summary.
import "server-only";

import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";
import type { Agent } from "@/lib/supabase/types";
import { RUNNERS, RUNNER_BY_AGENT, type RunnerId } from "./runners";

export type SchedulerSummary = {
  companies: number;
  agentsRun: number;
  proposalsCreated: number;
  failures: Array<{ company: string; agentKey: string; error: string }>;
  skipped: Array<{ agentKey: string; reason: string }>;
  // Echo back what the caller asked for — useful in the response body so the
  // dashboard can tell the user "ignored dueness because you clicked Run Now".
  respectedDueness: boolean;
  durationMs: number;
};

export type RunAllOptions = {
  // false = ignore dueness, run every live+enabled+mapped agent for every
  // company (the dashboard button uses this so a manual click always does work).
  // true  = honor schedule_hours (cron uses this so frequent ticks are cheap).
  respectDueness: boolean;
};

export async function runAllDue(opts: RunAllOptions): Promise<SchedulerSummary> {
  const startedAt = Date.now();
  const summary: SchedulerSummary = {
    companies: 0,
    agentsRun: 0,
    proposalsCreated: 0,
    failures: [],
    skipped: [],
    respectedDueness: opts.respectDueness,
    durationMs: 0,
  };

  if (!hasSupabaseEnv()) {
    summary.failures.push({
      company: "-",
      agentKey: "-",
      error: "Supabase not configured.",
    });
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  const sb = supabaseServer();

  const [{ data: companies }, { data: agents }] = await Promise.all([
    // LLM-driven runners (blog agent and future ones) read description +
    // profile via tool calls, so we hydrate the full row up front.
    sb.from("companies").select("id, url, name, description, profile, created_at"),
    sb
      .from("agents")
      .select("*")
      .eq("status", "live")
      .eq("enabled", true),
  ]);

  if (!companies?.length || !agents?.length) {
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }
  summary.companies = companies.length;

  // Surface "live but unrunnable" agents once per call so the operator notices
  // (e.g. when coding agent gets a runner later, this line will go away).
  const seenSkips = new Set<string>();
  for (const a of agents as Agent[]) {
    if (!RUNNER_BY_AGENT[a.key] && !seenSkips.has(a.key)) {
      seenSkips.add(a.key);
      summary.skipped.push({
        agentKey: a.key,
        reason: "Live in catalog but no runner registered yet.",
      });
    }
  }

  for (const company of companies) {
    const dueAgents = opts.respectDueness
      ? await selectDueAgents(sb, company.id, agents as Agent[])
      : (agents as Agent[]).filter((a) => RUNNER_BY_AGENT[a.key]);

    if (!dueAgents.length) continue;

    // Group due agents by runner so we fire each underlying engine once.
    const byRunner = new Map<RunnerId, Agent[]>();
    for (const a of dueAgents) {
      const rid = RUNNER_BY_AGENT[a.key];
      if (!rid) continue;
      const arr = byRunner.get(rid) ?? [];
      arr.push(a);
      byRunner.set(rid, arr);
    }

    for (const [runnerId, coveredAgents] of byRunner) {
      // 1) Insert a 'running' row per covered agent. We need the inserted IDs
      //    so we can mark each one done/failed after the runner returns.
      const runRows = coveredAgents.map((a) => ({
        company_id: company.id,
        agent_key: a.key,
        status: "running" as const,
      }));
      const { data: openedRuns, error: openErr } = await sb
        .from("agent_runs")
        .insert(runRows)
        .select("id, agent_key");
      if (openErr || !openedRuns) {
        summary.failures.push({
          company: company.name || company.id,
          agentKey: coveredAgents.map((a) => a.key).join(","),
          error: `Could not open agent_run row(s): ${openErr?.message ?? "unknown"}`,
        });
        continue;
      }

      // 2) Execute the runner. One try/catch per runner so a thrown error in
      //    one runner never bleeds into the other runners for this company.
      //    We pass the agent_key → run_id map so LLM-driven runners can write
      //    per-step trace rows into agent_logs.
      const runIdsByAgent: Record<string, string> = {};
      for (const r of openedRuns) runIdsByAgent[r.agent_key] = r.id;

      try {
        const result = await RUNNERS[runnerId](
          {
            id: company.id,
            url: company.url,
            name: company.name,
            description: company.description ?? null,
            profile: company.profile ?? {},
            created_at: company.created_at ?? "",
          },
          runIdsByAgent,
        );

        // If the runner returned a structured failure but didn't throw, fold
        // it into the summary so the operator can see why the run was empty.
        if (result.failure) {
          summary.failures.push({
            company: company.name || company.id,
            agentKey: coveredAgents.map((a) => a.key).join(","),
            error: result.failure,
          });
        }

        // 3) Insert proposals (one query). Some runners (Coding handoff)
        //    insert their own rows because they need each id to link back
        //    to a source handoff; those report the count via
        //    inlineInsertedCount instead of result.proposals.
        let insertedProposals: Array<{ agent_key: string }> = [];
        if (result.proposals.length) {
          const { data: ins, error: insErr } = await sb
            .from("proposals")
            .insert(
              result.proposals.map((p) => ({ ...p, company_id: company.id })),
            )
            .select("agent_key");
          if (insErr) throw insErr;
          insertedProposals = (ins ?? []) as Array<{ agent_key: string }>;
        }
        const inlineCount = result.inlineInsertedCount ?? 0;
        summary.proposalsCreated += insertedProposals.length + inlineCount;

        // 4) Attribute proposal counts to each covered agent and close out
        //    its run row. Done one update per row — fine at scale we care
        //    about (handful of agents × handful of companies per tick).
        //    Inline-inserted rows are attributed to the FIRST covered agent
        //    (they're always one runner = one agent today; the only inline
        //    runner is coding-handoff-agent which only maps to `coding`).
        const finishedAt = new Date().toISOString();
        for (const run of openedRuns) {
          const fromInsert = insertedProposals.filter(
            (p) => p.agent_key === run.agent_key,
          ).length;
          const fromInline =
            inlineCount > 0 && coveredAgents[0]?.key === run.agent_key
              ? inlineCount
              : 0;
          await sb
            .from("agent_runs")
            .update({
              status: "done",
              finished_at: finishedAt,
              proposals_created: fromInsert + fromInline,
            })
            .eq("id", run.id);
        }
        summary.agentsRun += coveredAgents.length;
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        const finishedAt = new Date().toISOString();
        // Mark every run row from this runner failed with the same error so
        // the activity log is honest about what happened.
        for (const run of openedRuns) {
          await sb
            .from("agent_runs")
            .update({ status: "failed", finished_at: finishedAt, error: msg })
            .eq("id", run.id);
          summary.failures.push({
            company: company.name || company.id,
            agentKey: run.agent_key,
            error: msg,
          });
        }
      }
    }
  }

  summary.durationMs = Date.now() - startedAt;
  return summary;
}

// "Due" = no successful run on record, OR latest successful run is older than
// the agent's schedule_hours. We only consider runs with status='done' so a
// stuck 'running' row doesn't suppress legitimate retries.
async function selectDueAgents(
  sb: ReturnType<typeof supabaseServer>,
  companyId: string,
  agents: Agent[],
): Promise<Agent[]> {
  const keys = agents.map((a) => a.key);
  if (!keys.length) return [];

  // One query per company — fetches every done-run for this company's agents
  // and we pick the latest per agent_key locally. Avoids an N+1 over agents.
  const { data: doneRuns } = await sb
    .from("agent_runs")
    .select("agent_key, started_at")
    .eq("company_id", companyId)
    .eq("status", "done")
    .in("agent_key", keys)
    .order("started_at", { ascending: false });

  const latest = new Map<string, string>();
  for (const r of doneRuns ?? []) {
    if (!latest.has(r.agent_key)) latest.set(r.agent_key, r.started_at);
  }

  const now = Date.now();
  return agents.filter((a) => {
    if (!RUNNER_BY_AGENT[a.key]) return false; // unmapped agents are never due
    const lastIso = latest.get(a.key);
    if (!lastIso) return true; // never run
    const ageHours = (now - new Date(lastIso).getTime()) / 3_600_000;
    return ageHours >= a.schedule_hours;
  });
}
