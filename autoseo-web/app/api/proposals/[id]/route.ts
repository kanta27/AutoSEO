// POST /api/proposals/:id  { decision: "approved" | "rejected" }
//
// Flips a proposal's status. Real publish actions (open GitHub PR, write to
// CMS) are a follow-up session — for now Approve just records intent.

import { NextResponse } from "next/server";
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 500 });
  }

  let decision: "approved" | "rejected";
  try {
    const body = (await req.json()) as { decision?: string };
    if (body.decision !== "approved" && body.decision !== "rejected") throw new Error();
    decision = body.decision;
  } catch {
    return NextResponse.json(
      { error: "decision must be 'approved' or 'rejected'" },
      { status: 400 }
    );
  }

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("proposals")
    .update({ status: decision, decided_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("status", "pending") // can't re-decide
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Not found or already decided." },
      { status: 404 }
    );
  }
  return NextResponse.json({ proposal: data });
}
