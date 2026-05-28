// POST /api/proposals/:id/cancel-handoff
//
// Removes a proposal from the Coding Agent's handoff queue. The proposal
// itself stays `approved` — we just clear handed_off_to_coding so it stops
// appearing in "Pending fix synthesis" and won't be processed by the next
// Coding run.
//
// This is the user-facing escape hatch from "I approved this but I don't
// actually want a PR for it." Only valid while the handoff is still
// unsynthesized — once Coding has produced a companion code_change, the
// handoff is already complete and there's nothing to cancel here. The
// linked code_change can still be rejected normally.

import { NextResponse } from "next/server";
import { supabaseServer, hasSupabaseEnv } from "@/lib/supabase/server";
import type { Proposal } from "@/lib/supabase/types";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 500 });
  }
  const sb = supabaseServer();

  const { data: row, error: lookupErr } = await sb
    .from("proposals")
    .select("*")
    .eq("id", params.id)
    .single();
  if (lookupErr || !row) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const p = row as Proposal;
  if (!p.handed_off_to_coding) {
    return NextResponse.json(
      { error: "Proposal is not in the Coding handoff queue." },
      { status: 409 },
    );
  }
  if (p.handoff_synthesized_proposal_id) {
    return NextResponse.json(
      {
        error:
          "Handoff already synthesized. Reject the linked code_change to undo.",
      },
      { status: 409 },
    );
  }

  const { data, error } = await sb
    .from("proposals")
    .update({
      handed_off_to_coding: false,
      // Wipe any previous "couldn't synthesize" diagnostic — the user is
      // explicitly removing this from the queue, not retrying.
      publish_error: null,
    })
    .eq("id", params.id)
    .select("*")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Update failed." }, { status: 500 });
  }
  return NextResponse.json({ proposal: data });
}
