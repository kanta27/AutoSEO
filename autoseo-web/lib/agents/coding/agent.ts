// Coding Agent — processes the handoff queue.
//
// Read: every approved proposal where handed_off_to_coding=true and no
// companion code_change exists yet. For each, synthesize a code_change
// proposal whose approval (the SECOND gate) actually opens the PR.
//
// Dispatch by source type:
//   • blog_post                                 → deterministic markdown PR
//   • issue_critical / issue_high (solver=description) → LLM meta-description fix
//   • geo_gap                                   → LLM page front-load rewrite
//   • anything else                             → "couldn't synthesize" reason
//
// Resilience contract:
//   • Each handoff is processed in its own try/catch.
//   • A failed synthesis leaves the original row's handed_off_to_coding=true
//     AND writes a reason into publish_error so the user sees it in the UI.
//     The flag is intentionally NOT cleared — the next Coding run can retry.
//   • A handful of handoffs per run (HANDOFF_BATCH) keeps cost bounded.
import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import type { Company, Proposal } from "@/lib/supabase/types";
import type { NewProposal } from "@/lib/proposals";
import { synthesizeBlogHandoff } from "./blog-handoff";
import { synthesizeSeoHandoff, synthesizeGeoHandoff } from "./seo-geo-handoff";

const HANDOFF_BATCH = 5;

export type CodingAgentResult = {
  // New code_change rows to insert. The scheduler/runner records insertion
  // via the standard proposals insert; we also do a follow-up update to
  // link the source proposal — handled inside this function (NOT delegated
  // to the caller, because the link needs the inserted code_change's id).
  proposals: NewProposal[];
  // Per-handoff log lines for the scheduler summary's failure field.
  failure: string | null;
  // Useful when the runner runs in isolation (per-agent Run endpoint) and
  // we want to tell the user "I tried 3, made 2 PRs, 1 couldn't be synthesized."
  processed: number;
  synthesized: number;
  skipped: Array<{ handoffId: string; reason: string }>;
};

export async function runCodingAgent(
  company: Company,
  runId: string | undefined,
): Promise<CodingAgentResult> {
  const sb = supabaseServer();
  const { data: queueRows } = await sb
    .from("proposals")
    .select("*")
    .eq("company_id", company.id)
    .eq("handed_off_to_coding", true)
    .is("handoff_synthesized_proposal_id", null)
    .order("decided_at", { ascending: true })
    .limit(HANDOFF_BATCH);

  const queue = (queueRows ?? []) as Proposal[];
  const result: CodingAgentResult = {
    proposals: [],
    failure: null,
    processed: queue.length,
    synthesized: 0,
    skipped: [],
  };

  if (!queue.length) {
    // Nothing in the queue — surface as a benign skip in the scheduler summary
    // so the operator can tell "no work" apart from "the agent broke".
    result.failure = "No pending handoffs.";
    return result;
  }

  for (const handoff of queue) {
    try {
      const outcome = await dispatch(handoff, company, runId);
      if (outcome.ok) {
        // Insert the synthesized proposal, then link the original to it.
        const { data: inserted, error: insErr } = await sb
          .from("proposals")
          .insert({ ...outcome.proposal, company_id: company.id })
          .select("id")
          .single();
        if (insErr || !inserted) {
          await markHandoffFailed(
            sb,
            handoff.id,
            `Synthesized proposal but DB insert failed: ${insErr?.message ?? "unknown"}`,
          );
          result.skipped.push({
            handoffId: handoff.id,
            reason: insErr?.message ?? "insert failed",
          });
          continue;
        }
        await sb
          .from("proposals")
          .update({
            handoff_synthesized_proposal_id: inserted.id,
            // Clear any prior "couldn't synthesize" stamp.
            publish_error: null,
          })
          .eq("id", handoff.id);
        // Don't push to result.proposals — we already inserted it ourselves
        // (the runner's caller does another insert pass; pushing here would
        // duplicate). Use a separate counter instead.
        result.synthesized += 1;
      } else {
        await markHandoffFailed(sb, handoff.id, outcome.reason);
        result.skipped.push({ handoffId: handoff.id, reason: outcome.reason });
      }
    } catch (err) {
      // Per-handoff resilience: one bad handoff never crashes the others.
      // Log the full error so devs can see which handoff blew up and why —
      // publish_error only stores a 500-char summary.
      console.error(
        `[agent:coding-agent:dispatch] error caught (handoffId=${handoff.id}, type=${handoff.type}):`,
        err,
      );
      if ((err as { cause?: unknown })?.cause) console.error("  cause:", (err as { cause: unknown }).cause);
      if ((err as { response?: { data?: unknown } })?.response?.data) console.error("  response.data:", (err as { response: { data: unknown } }).response.data);
      if ((err as { body?: unknown })?.body) console.error("  body:", (err as { body: unknown }).body);
      if ((err as { stack?: unknown })?.stack) console.error("  stack:", (err as { stack: unknown }).stack);
      const msg = err instanceof Error ? err.message : String(err);
      await markHandoffFailed(sb, handoff.id, `Unexpected error: ${msg}`);
      result.skipped.push({ handoffId: handoff.id, reason: msg });
    }
  }

  // Fold per-handoff outcomes into one summary line for the scheduler. We
  // never throw — every handoff result is on record.
  if (result.skipped.length) {
    result.failure =
      `Synthesized ${result.synthesized}/${result.processed}; ` +
      `${result.skipped.length} couldn't be synthesized (see proposal.publish_error for details).`;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Dispatch by the original proposal's type. Synchronous for blog; async for
// LLM-driven SEO/GEO paths.
type DispatchOutcome =
  | { ok: true; proposal: NewProposal }
  | { ok: false; reason: string };

async function dispatch(
  handoff: Proposal,
  company: Company,
  runId: string | undefined,
): Promise<DispatchOutcome> {
  switch (handoff.type) {
    case "blog_post":
      return synthesizeBlogHandoff(handoff);
    case "issue_critical":
    case "issue_high":
      return synthesizeSeoHandoff(company, handoff, runId);
    case "geo_gap":
      return synthesizeGeoHandoff(company, handoff, runId);
    default:
      return {
        ok: false,
        reason:
          `No synthesis path for handoff type "${handoff.type}". The approval ` +
          `handler shouldn't be sending this type to Coding — please open a bug.`,
      };
  }
}

async function markHandoffFailed(
  sb: ReturnType<typeof supabaseServer>,
  proposalId: string,
  reason: string,
): Promise<void> {
  await sb
    .from("proposals")
    .update({ publish_error: reason.slice(0, 500) })
    .eq("id", proposalId);
}
