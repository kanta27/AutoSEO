// /dashboard/agents/[key]
//
// Per-agent drill-down. Two layouts:
//   • For most agents (seo/geo/blog): an AgentRunButton + the existing
//     ActionsFeed scoped to this agent's proposals.
//   • For coding: AgentRunButton + TWO sections — "Pending fix synthesis"
//     (handed-off proposals from other agents) and "PRs ready to open"
//     (synthesized code_change proposals). The two stages match the
//     dashboard card's two-line count.
//
// All approval logic stays in /api/proposals/[id] — no per-page bypasses.
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";
import { ActionsFeed } from "@/components/ActionsFeed";
import { AgentRunButton } from "@/components/AgentRunButton";
import { CodingHandoffQueue } from "@/components/CodingHandoffQueue";
import type {
  Agent,
  AgentRun,
  Company,
  Proposal,
} from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function AgentDrilldownPage({
  params,
  searchParams,
}: {
  params: { key: string };
  searchParams: { company?: string };
}) {
  if (!hasSupabaseEnv()) {
    return (
      <main className="mx-auto max-w-2xl p-10 text-center">
        <h1 className="t-h2 mb-2">Supabase not configured</h1>
        <p className="text-ink-3">
          Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
        </p>
      </main>
    );
  }

  const sb = supabaseServer();
  const companyQuery = searchParams.company
    ? sb.from("companies").select("*").eq("id", searchParams.company).maybeSingle()
    : sb
        .from("companies")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

  const { data: company } = await companyQuery;
  if (!company) redirect("/");
  const co = company as Company;

  // Coding gets two extra fetches (the handoff queue + the code_change list).
  // Other agents only need the agent's own pending proposals.
  const isCoding = params.key === "coding";

  const baseQueries = await Promise.all([
    sb.from("agents").select("*").eq("key", params.key).maybeSingle(),
    sb.from("agents").select("*").order("name"),
    sb
      .from("agent_runs")
      .select("*")
      .eq("company_id", co.id)
      .eq("agent_key", params.key)
      .order("started_at", { ascending: false })
      .limit(5),
  ]);
  const { data: agentRow } = baseQueries[0];
  const { data: agentsRows } = baseQueries[1];
  const { data: runRows } = baseQueries[2];

  if (!agentRow) notFound();
  const agent = agentRow as Agent;
  const agents = (agentsRows ?? []) as Agent[];
  const runs = (runRows ?? []) as AgentRun[];

  // Per-agent proposal fetches diverge here. Non-coding agents just want
  // their own row's proposals. Coding wants the handoff queue (foreign
  // agent_keys) AND its own code_change rows.
  let codingHandoffs: Proposal[] = [];
  let codingProposals: Proposal[] = [];
  let normalProposals: Proposal[] = [];

  if (isCoding) {
    const [handoffsRes, codeRes] = await Promise.all([
      sb
        .from("proposals")
        .select("*")
        .eq("company_id", co.id)
        .eq("handed_off_to_coding", true)
        .is("handoff_synthesized_proposal_id", null)
        .order("decided_at", { ascending: true }),
      sb
        .from("proposals")
        .select("*")
        .eq("company_id", co.id)
        .eq("agent_key", "coding")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    codingHandoffs = (handoffsRes.data ?? []) as Proposal[];
    codingProposals = (codeRes.data ?? []) as Proposal[];
  } else {
    const { data: rows } = await sb
      .from("proposals")
      .select("*")
      .eq("company_id", co.id)
      .eq("agent_key", params.key)
      .order("created_at", { ascending: false })
      .limit(200);
    normalProposals = (rows ?? []) as Proposal[];
  }

  return (
    <main className="min-h-screen px-4 py-6 md:px-6">
      <header className="mx-auto mb-6 flex max-w-[1200px] items-center justify-between gap-4">
        <Link
          href={`/dashboard${searchParams.company ? `?company=${searchParams.company}` : ""}`}
          className="t-eyebrow hover:text-ink"
        >
          ← Back to dashboard
        </Link>
        <span className="hidden font-mono text-[12px] text-ink-3 sm:inline">{co.url}</span>
      </header>

      <div className="mx-auto max-w-[1200px] space-y-6">
        <section className="panel">
          <div className="panel-header flex items-center justify-between">
            <span>{agent.name}</span>
            <div className="flex items-center gap-3">
              <AgentRunButton
                agentKey={agent.key}
                companyId={co.id}
                liveStatus={agent.status}
              />
              <span className={agent.status === "live" ? "chip chip-live" : "chip chip-soon"}>
                {agent.status === "live" ? "live" : "soon"}
              </span>
            </div>
          </div>
          <div className="p-5">
            {agent.description && (
              <p className="text-[13px] leading-[1.55] text-ink-2">{agent.description}</p>
            )}
          </div>
        </section>

        {isCoding ? (
          <>
            <section className="panel">
              <div className="panel-header">
                <span>Pending fix synthesis</span>
                <span className="font-mono text-[11px] text-ink-3">
                  {codingHandoffs.length}
                </span>
              </div>
              <CodingHandoffQueue handoffs={codingHandoffs} />
            </section>

            <section className="panel">
              <div className="panel-header">
                <span>PRs ready to open</span>
              </div>
              <div className="p-5">
                <ActionsFeed
                  companyId={co.id}
                  initialProposals={codingProposals}
                  agents={agents}
                  companyPlatform={co.platform}
                />
              </div>
            </section>
          </>
        ) : (
          <section className="panel">
            <div className="panel-header">
              <span>Queue</span>
            </div>
            <div className="p-5">
              <ActionsFeed
                companyId={co.id}
                initialProposals={normalProposals}
                agents={agents}
                companyPlatform={co.platform}
              />
            </div>
          </section>
        )}

        <section className="panel">
          <div className="panel-header">
            <span>Recent runs</span>
            <span className="font-mono text-[11px] text-ink-3">last {runs.length}</span>
          </div>
          {runs.length === 0 ? (
            <p className="p-5 text-[13px] text-ink-3">
              No runs yet for this agent.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {runs.map((r) => (
                <li
                  key={r.id}
                  className="grid grid-cols-[1fr_auto_auto_1fr] items-center gap-4 px-5 py-2.5 text-[13px]"
                >
                  <span className="font-mono text-[12px] text-ink-3">
                    {relativeTime(r.started_at)}
                  </span>
                  <RunStatusChip status={r.status} />
                  <span className="font-mono text-[12px] text-ink-2">
                    {r.status === "done" ? `${r.proposals_created} proposal(s)` : ""}
                  </span>
                  <span
                    className="truncate text-[12px] text-warn"
                    title={r.error ?? undefined}
                  >
                    {r.error ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function RunStatusChip({ status }: { status: AgentRun["status"] }) {
  if (status === "done") return <span className="chip chip-live">done</span>;
  if (status === "failed") return <span className="chip text-warn">failed</span>;
  return <span className="chip chip-soon">running</span>;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
