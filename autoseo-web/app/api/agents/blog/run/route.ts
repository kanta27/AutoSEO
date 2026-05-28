// POST /api/agents/blog/run  { companyId }
//
// Triggers a single Blog Agent run for the given company. Inserts an
// agent_runs row, runs the LLM loop, inserts the resulting blog_post
// proposal (if any), and reports back. Mirrors the shape of
// /api/agents/seo/run for consistency.

import { NextResponse } from "next/server";
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";
import { runBlogAgent } from "@/lib/agents/blog/agent";
import type { Company, Proposal } from "@/lib/supabase/types";

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
  // The blog agent reads brand voice + product info via tool calls, so we
  // hydrate the full company row (not just id/url like the SEO runner).
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
    .insert({ company_id: companyId, agent_key: "blog", status: "running" })
    .select("id")
    .single();
  const runId = run?.id as string | undefined;

  try {
    const result = await runBlogAgent(company as Company, runId);
    let inserted: Proposal[] = [];
    if (result.proposals.length) {
      const { data, error } = await sb
        .from("proposals")
        .insert(
          result.proposals.map((p) => ({ ...p, company_id: companyId })),
        )
        .select("*");
      if (error) throw error;
      inserted = (data ?? []) as Proposal[];
    }

    if (runId) {
      await sb
        .from("agent_runs")
        .update({
          // A run that produced no proposals (budget exhausted, agent gave up)
          // is still 'done' — the failure reason goes on the response, not the
          // run status. 'failed' is reserved for thrown errors.
          status: "done",
          finished_at: new Date().toISOString(),
          proposals_created: inserted.length,
          error: result.failure ?? null,
        })
        .eq("id", runId);
    }

    return NextResponse.json({
      runId,
      proposals: inserted,
      failure: result.failure ?? null,
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
