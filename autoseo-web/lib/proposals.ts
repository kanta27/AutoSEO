// Maps a Node engine audit report → rows for the `proposals` table. One row
// per critical/high issue + one per GEO citable gap + one summary card. The
// dashboard's Actions Feed reads from `proposals` and never re-derives this.
import type { AuditFix, AuditReport } from "./engines/node-audit";

export type NewProposal = {
  agent_key: string;
  type: string;
  title: string;
  summary: string | null;
  payload: Record<string, unknown>;
};

const HIGH_SEVERITIES = new Set(["critical", "high"]);

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

  // 3. GEO citable gaps. The Node engine's `geo` auditor populates findings;
  //    if a richer Python-swarm geo block is merged in later we surface those
  //    as separate, more actionable rows.
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
// geo / social). Everything geo-flavoured surfaces under the GEO agent in the
// feed; everything else under SEO. Keeps the feed grouping aligned with the
// agent grid on the landing page.
function classifyAgent(category?: string): string {
  if (category === "geo") return "geo";
  return "seo";
}
