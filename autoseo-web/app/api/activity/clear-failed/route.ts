// POST /api/activity/clear-failed
//
// Deletes all `agent_runs` rows whose status is 'failed'. Returns { deleted }.
//
// Secret-protected via the same `x-scheduler-secret` header pattern as
// /api/scheduler/run. The dashboard's Clear-failed button never sees this
// secret — a Server Action (lib/actions/clear-failed.ts) does the delete
// directly server-side. This route exists for cron / external clients that
// want to schedule a periodic cleanup.

import { NextResponse } from "next/server";
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.SCHEDULER_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "SCHEDULER_SECRET not configured on the server." },
      { status: 500 },
    );
  }
  const provided = req.headers.get("x-scheduler-secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 500 });
  }
  const sb = supabaseServer();
  // .select("id") returns the rows we deleted so we can count them. We don't
  // need them otherwise — postgrest's .delete() doesn't have a native count.
  const { data, error } = await sb
    .from("agent_runs")
    .delete()
    .eq("status", "failed")
    .select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ deleted: data?.length ?? 0 });
}
