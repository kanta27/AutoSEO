// Maps a Node engine audit report → rows for the `proposals` table. One row
// per critical/high issue + one per GEO citable gap + one summary card. The
// dashboard's Actions Feed reads from `proposals` and never re-derives this.
import type { AuditFix, AuditReport } from "./engines/node-audit";
import type { supabaseServer } from "@/lib/supabase/server";

export type NewProposal = {
  agent_key: string;
  type: string;
  title: string;
  summary: string | null;
  payload: Record<string, unknown>;
};

const HIGH_SEVERITIES = new Set(["critical", "high"]);
// GEO findings are sometimes medium / low (the geo auditor's stats, q&a,
// structure, author, date checks are all "low"). The HIGH_SEVERITIES filter
// silently dropped them, leaving the GEO drilldown empty. For GEO we keep
// everything except positive wins ("good") so the user sees the whole picture.
const GEO_INCLUDED_SEVERITIES = new Set<string>([
  "critical",
  "high",
  "medium",
  "low",
]);

// ---------------------------------------------------------------------------
// Dedup helpers (Session A — three-feed UI cleanup).
//
// Two kinds of duplication can produce "same finding twice" rows in the feed:
//   1. Within ONE run, the underlying engine can produce two findings with
//      the same title (rare, but the Node auditor can double-flag a page).
//   2. Across runs, the SAME audit on the SAME site reports the SAME findings.
//      The user has already seen and acted on (or is currently acting on) those
//      rows; re-inserting just clones the queue and wastes their attention.
//
// Both are handled here. The agent-run callers wrap their proposals in
// `filterNewProposals` before inserting; the dedup is transparent to the
// engine code.

// Exact-match dedup key. Title is the primary signal — same finding = same
// title. Type is a tiebreaker so e.g. a homepage with both an "issue_high"
// AND an "audit_summary" titled identically would still produce two rows.
function dedupKey(row: { title: string; type: string }): string {
  return `${row.type}::${row.title}`;
}

// In-memory dedup over an array, preserving the first occurrence. Pure fn.
export function dedupeProposals(rows: NewProposal[]): NewProposal[] {
  const seen = new Set<string>();
  const out: NewProposal[] = [];
  for (const r of rows) {
    const k = dedupKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

// Statuses that mean "this proposal is still live in the user's queue or has
// already shipped". Re-inserting a duplicate of one of these would clone work
// the user has already engaged with. publish_failed is excluded so a retry
// genuinely retries with a fresh row if needed; rejected is excluded so the
// user can re-surface a finding they previously dismissed (rejection IS the
// explicit dismiss path on the server, even though the UI no longer shows
// a Reject button — Cancel-handoff is the surviving dismiss flow).
const SUPPRESS_STATUSES = new Set(["pending", "approved", "published"]);

// Filter `rows` down to the ones that don't already exist for this company in
// one of the SUPPRESS_STATUSES. Within-list dedup is applied first. Returns
// the filtered list AND a count of duplicates removed so the caller can echo
// "5 findings · 2 new · 3 already known" back to the UI.
export async function filterNewProposals(
  sb: ReturnType<typeof supabaseServer>,
  companyId: string,
  rows: NewProposal[],
): Promise<{ newRows: NewProposal[]; dupedCount: number }> {
  const beforeWithin = rows.length;
  const withinDeduped = dedupeProposals(rows);
  const withinDupes = beforeWithin - withinDeduped.length;

  if (withinDeduped.length === 0) {
    return { newRows: [], dupedCount: withinDupes };
  }

  // One round-trip for the across-runs check. The `in()` filter stays small
  // because we bound the input to whatever the engine emitted (~5-20 rows).
  const titles = withinDeduped.map((r) => r.title);
  const { data: existing } = await sb
    .from("proposals")
    .select("title, status")
    .eq("company_id", companyId)
    .in("title", titles)
    .in("status", Array.from(SUPPRESS_STATUSES));
  const suppress = new Set(
    (existing ?? [])
      .filter((e) => SUPPRESS_STATUSES.has(e.status as string))
      .map((e) => e.title as string),
  );

  const newRows = withinDeduped.filter((r) => !suppress.has(r.title));
  const acrossDupes = withinDeduped.length - newRows.length;
  return { newRows, dupedCount: withinDupes + acrossDupes };
}

export function proposalsFromAudit(report: AuditReport): NewProposal[] {
  const out: NewProposal[] = [];

  // 1. Header card — always one, scoped to the SEO agent.
  out.push({
    agent_key: "seo",
    type: "audit_summary",
    title: `SEO audit: ${report.grade} (${report.score}/100)`,
    summary: summarizeCounts(report.counts),
    payload: {
      score: report.score,
      grade: report.grade,
      counts: report.counts,
      byCategory: report.byCategory ?? null,
      meta: report.meta,
    },
  });

  // 2. One proposal per high-priority issue. We attach the matching fix from
  //    report.solutions.fixes (joined by findingId when the engine includes it).
  const fixesByFinding = new Map<string, AuditFix>();
  for (const f of report.solutions?.fixes ?? []) {
    if (f.findingId) fixesByFinding.set(f.findingId, f);
  }

  for (const issue of report.issues ?? []) {
    // Branch 1 — GEO findings become `geo_gap` proposals.
    //
    // They were previously dropped here entirely: HIGH_SEVERITIES only let
    // critical/high through, and the Node engine's GEO auditor emits at
    // medium/low almost exclusively, so the GEO drilldown stayed empty.
    //
    // We:
    //   • include every severity except "good" (wins don't belong in the queue)
    //   • emit type=geo_gap so the approval handler dispatches the row to
    //     Coding's `synthesizeGeoHandoff` path
    //   • shape payload.gap = { topic, gap_type, suggested_addition } to match
    //     what buildGeoSystemPrompt and getKeywordGapsTool already read
    //   • prefix the title with "GEO: " to keep it distinct from the future
    //     Python-swarm `Citable gap: …` rows the next block reserves
    if (issue.category === "geo") {
      if (!GEO_INCLUDED_SEVERITIES.has(issue.severity)) continue;
      const fix = issue.id ? fixesByFinding.get(issue.id) : undefined;
      out.push({
        agent_key: "geo",
        type: "geo_gap",
        title: `GEO: ${issue.title}`,
        summary: issue.detail || issue.evidence || null,
        payload: {
          gap: {
            topic: issue.title,
            gap_type: issue.id ?? "geo-finding",
            suggested_addition:
              issue.solver?.hint ||
              issue.detail ||
              issue.evidence ||
              "Improve this page's AI-citability per the GEO finding above.",
          },
          issue,
          suggestedFix: fix ?? null,
        },
      });
      continue;
    }
    // Branch 2 — non-GEO categories keep the original behaviour: only
    // critical/high get a row, attributed under SEO via classifyAgent.
    if (!HIGH_SEVERITIES.has(issue.severity)) continue;
    const fix = issue.id ? fixesByFinding.get(issue.id) : undefined;
    out.push({
      agent_key: classifyAgent(issue.category),
      type: `issue_${issue.severity}`,
      title: issue.title,
      summary: issue.detail || issue.evidence || null,
      payload: { issue, suggestedFix: fix ?? null },
    });
  }

  // 3. GEO citable gaps — RESERVED for the future Python-swarm (A10) block.
  //    The current Node engine doesn't populate `report.geo.citable_gaps`, so
  //    this loop is a no-op today. When the swarm lands and produces a
  //    structured citable_gaps array, those rows surface here with the
  //    `Citable gap: …` title prefix — distinct from the `GEO: …` prefix the
  //    flat-finding branch above uses, so the two streams won't collide in
  //    the dedup pass.
  const geo = report.geo;
  if (geo?.citable_gaps?.length) {
    for (const gap of geo.citable_gaps) {
      out.push({
        agent_key: "geo",
        type: "geo_gap",
        title: `Citable gap: ${gap.topic}`,
        summary: gap.suggested_addition,
        payload: { gap, readiness: geo.geo_readiness_score ?? null },
      });
    }
  }

  return out;
}

function summarizeCounts(counts: Record<string, number> = {}): string {
  const parts: string[] = [];
  if (counts.critical) parts.push(`${counts.critical} critical`);
  if (counts.high) parts.push(`${counts.high} high`);
  if (counts.medium) parts.push(`${counts.medium} medium`);
  if (counts.low) parts.push(`${counts.low} low`);
  if (counts.good) parts.push(`${counts.good} good`);
  return parts.length ? parts.join(" · ") : "No issues found";
}

// Issues from the Node engine carry a category (on-page / technical / schema /
// geo / social). Originally a "geo" category routed under the GEO agent here;
// since the GEO branch in proposalsFromAudit now intercepts that case before
// this helper is called, the "geo" arm is defensive-only — kept in case a
// future caller imports classifyAgent directly.
function classifyAgent(category?: string): string {
  if (category === "geo") return "geo";
  return "seo";
}
