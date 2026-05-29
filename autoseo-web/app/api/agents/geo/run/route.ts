// POST /api/agents/geo/run  { companyId }
//
// Same engine call as /api/agents/seo/run — the Node audit produces findings
// for both agents. This endpoint exists separately so the GEO drill-down can
// have its own Run button without the SEO label, and so the agent_runs row
// is attributed to `geo`. The button copy is the only user-visible difference.

import { NextResponse } from "next/server";
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";
import { runNodeAudit, EngineUnavailableError } from "@/lib/engines/node-audit";
import { filterNewProposals, proposalsFromAudit } from "@/lib/proposals";
import type { Proposal } from "@/lib/supabase/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 500 });
  }

  let companyId: string;
  try {
    const body = (await req.json()) as { companyId?: string };
    if (!body.companyId) throw new Error();
    companyId = body.companyId;
  } catch {
    return NextResponse.json({ error: "Provide 'companyId'." }, { status: 400 });
  }

  const sb = supabaseServer();
  const { data: company, error: companyErr } = await sb
    .from("companies")
    .select("id, url")
    .eq("id", companyId)
    .single();
  if (companyErr || !company) {
    return NextResponse.json({ error: "Company not found." }, { status: 404 });
  }

  const { data: run } = await sb
    .from("agent_runs")
    .insert({ company_id: companyId, agent_key: "geo", status: "running" })
    .select("id")
    .single();
  const runId = run?.id as string | undefined;

  try {
    const report = await runNodeAudit(company.url, { withFixes: true });
    // proposalsFromAudit produces BOTH SEO and GEO rows from one audit. We
    // insert them all attributed to their respective agent_keys — same as the
    // /seo/run endpoint does — because they're the same engine call. The
    // per-agent button copy is just a UX framing.
    const allProps = proposalsFromAudit(report);
    const { newRows, dupedCount } = await filterNewProposals(sb, companyId, allProps);
    const withCompany = newRows.map((p) => ({ ...p, company_id: companyId }));

    let inserted: Proposal[] = [];
    if (withCompany.length) {
      const { data, error } = await sb
        .from("proposals")
        .insert(withCompany)
        .select("*");
      if (error) throw error;
      inserted = (data ?? []) as Proposal[];
    }

    // GEO-only counts. The audit produces BOTH SEO and GEO rows from one
    // engine call, but the GEO drilldown's Run button should reflect only
    // what shows up in the GEO feed — otherwise the "N findings · M new"
    // header lies about how productive the run was for this agent.
    const geoInserted = inserted.filter((p) => p.agent_key === "geo");
    const geoTotal = allProps.filter((p) => p.agent_key === "geo").length;
    // Dedup count for GEO is whatever GEO-shaped rows the engine produced
    // but didn't insert. Clamped at zero in case future code paths shift the
    // arithmetic.
    const geoDuped = Math.max(0, geoTotal - geoInserted.length);

    if (runId) {
      await sb
        .from("agent_runs")
        .update({
          status: "done",
          finished_at: new Date().toISOString(),
          proposals_created: geoInserted.length,
        })
        .eq("id", runId);
    }

    return NextResponse.json({
      runId,
      proposals: geoInserted,
      proposals_total: geoTotal,
      proposals_new: geoInserted.length,
      proposals_deduped: geoDuped,
      // Echo dupedCount (audit-wide) so any caller that wants the cross-agent
      // total can still read it. Existing consumers (AgentRunButton) read
      // the per-agent fields above.
      proposals_deduped_total: dupedCount,
    });
  } catch (err) {
    const msg =
      err instanceof EngineUnavailableError
        ? err.message
        : err instanceof Error
        ? err.message
        : "Unknown error";
    if (runId) {
      await sb
        .from("agent_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error: msg.slice(0, 500),
        })
        .eq("id", runId);
    }
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
