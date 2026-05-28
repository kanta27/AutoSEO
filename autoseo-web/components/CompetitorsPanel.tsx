// Top-right panel — Competitors.
//
// Sources (in priority order):
//   1. companies.profile.competitors  → array of { name, url?, why? }
//   2. documents.kind = 'competitor_analysis' → markdown body (first paragraph)
//   3. Neither → honest empty state.
//
// No fabrication, no fake competitors. The "Competitor Strategy" agent (Python
// swarm) is a named follow-up session that will populate either of the above.
import type { Company, CompanyDocument } from "@/lib/supabase/types";

type CompetitorEntry = { name: string; url?: string; why?: string };

export function CompetitorsPanel({
  company,
  documents,
}: {
  company: Company;
  // The full documents list for the company. We only read the
  // competitor_analysis kind here; other kinds are ignored.
  documents: CompanyDocument[];
}) {
  const competitors = readCompetitors(company);
  const analysisDoc = documents.find((d) => d.kind === "competitor_analysis");

  return (
    <aside className="panel flex h-full flex-col">
      <div className="panel-header">
        <span>Competitors</span>
        {competitors.length > 0 && (
          <span className="font-mono text-[11px] text-ink-3">{competitors.length}</span>
        )}
      </div>
      <div className="flex-1 p-5">
        {competitors.length > 0 ? (
          <CompetitorList items={competitors} />
        ) : analysisDoc && analysisDoc.body.trim() ? (
          <AnalysisSnippet body={analysisDoc.body} />
        ) : (
          <EmptyState />
        )}
      </div>
    </aside>
  );
}

// Defensive read: anything other than a well-shaped array is treated as
// "no data". We never throw on a malformed profile.
function readCompetitors(company: Company): CompetitorEntry[] {
  const raw = (company.profile as { competitors?: unknown }).competitors;
  if (!Array.isArray(raw)) return [];
  const out: CompetitorEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as { name?: unknown; url?: unknown; why?: unknown };
    if (typeof obj.name !== "string" || !obj.name.trim()) continue;
    out.push({
      name: obj.name,
      url: typeof obj.url === "string" ? obj.url : undefined,
      why: typeof obj.why === "string" ? obj.why : undefined,
    });
  }
  return out;
}

function CompetitorList({ items }: { items: CompetitorEntry[] }) {
  const visible = items.slice(0, 5);
  const overflow = items.length - visible.length;
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {visible.map((c, i) => (
          <li
            key={`${c.name}-${i}`}
            className="rounded-md border border-line bg-card-2 px-3 py-2 text-[13px]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-ink">{c.name}</span>
              {c.url && (
                <a
                  href={normalizeHref(c.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-mono text-[11px] text-ink-3 hover:text-ink hover:underline"
                  title={c.url}
                >
                  {prettyHost(c.url)}
                </a>
              )}
            </div>
            {c.why && (
              <p className="mt-1 text-[12px] leading-[1.4] text-ink-3">{c.why}</p>
            )}
          </li>
        ))}
      </ul>
      {overflow > 0 && (
        <p className="text-[11px] text-ink-3">+ {overflow} more</p>
      )}
    </div>
  );
}

function AnalysisSnippet({ body }: { body: string }) {
  // First non-empty paragraph as a teaser. The full doc lives elsewhere.
  const firstPara = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p.length > 0) ?? "";
  return (
    <div>
      <p className="text-[12px] leading-[1.5] text-ink-2">
        {firstPara.length > 280 ? firstPara.slice(0, 280) + "…" : firstPara}
      </p>
      <p className="mt-2 text-[11px] text-ink-3">
        From competitor analysis document.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-[12px] leading-[1.6] text-ink-3">
      <p>No competitor data yet.</p>
      <p className="mt-2">
        The Competitor Strategy agent isn&apos;t connected to this dashboard
        yet — coming soon.
      </p>
    </div>
  );
}

function normalizeHref(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function prettyHost(raw: string): string {
  try {
    return new URL(normalizeHref(raw)).hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
}
