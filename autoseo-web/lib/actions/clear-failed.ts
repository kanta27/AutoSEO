// Server Action — "Clear failed runs" button calls this from the client.
//
// Why a Server Action instead of a fetch from the browser? The cron-facing
// route at /api/activity/clear-failed requires the SCHEDULER_SECRET header,
// and that secret must never reach the browser. This action runs on the
// server, so the deletion happens directly via supabaseServer() without
// exposing any secret material.
"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";

export type ClearFailedResult =
  | { ok: true; deleted: number }
  | { ok: false; error: string };

export async function clearFailedRuns(): Promise<ClearFailedResult> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: "Supabase not configured." };
  }
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("agent_runs")
    .delete()
    .eq("status", "failed")
    .select("id");
  if (error) {
    return { ok: false, error: error.message };
  }
  // Invalidate the dashboard so the Activity table re-renders without the
  // cleared rows on the next render.
  revalidatePath("/dashboard");
  return { ok: true, deleted: data?.length ?? 0 };
}
