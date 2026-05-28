// POST /api/agents/coding/run  { companyId }
//
// Triggers the Coding Agent for the given company: processes the queue of
// handed-off SEO/GEO/Blog approvals and synthesizes `code_change` proposals.
// The Coding Agent NEVER opens PRs itself — each synthesized code_change
// sits as `status='pending'` for the user to approve as the second gate.

import { NextResponse } from "next/server";
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";
import { runCodingAgent } from "@/lib/agents/coding/agent";
import type { Company } from "@/lib/supabase/types";

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
    .select("id, url, name, description, profile, created_at, platform, platform_meta")
    .eq("id", companyId)
    .single();
  if (companyErr || !company) {
    return NextResponse.json({ error: "Company not found." }, { status: 404 });
  }

  const { data: run } = await sb
    .from("agent_runs")
    .insert({ company_id: companyId, agent_key: "coding", status: "running" })
    .select("id")
    .single();
  const runId = run?.id as string | undefined;

  try {
    // runCodingAgent inserts its own proposals (it needs the new id to link
    // back to the source handoff). We just record the run + return the
    // summary so the UI can refresh and show the updated counts.
    const result = await runCodingAgent(company as Company, runId);

    if (runId) {
      await sb
        .from("agent_runs")
        .update({
          status: "done",
          finished_at: new Date().toISOString(),
          proposals_created: result.synthesized,
          error: result.failure ?? null,
        })
        .eq("id", runId);
    }

    return NextResponse.json({
      runId,
      processed: result.processed,
      synthesized: result.synthesized,
      skipped: result.skipped,
      failure: result.failure,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
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
