// Top-middle panel — "Graphs": the score + category breakdown the user wants
// at-a-glance. Real GSC/GA wiring is a follow-up session, so the trend slot
// is an honest "connect for traffic data" placeholder, not a fake chart.
//
// Reads the latest audit_summary proposal — the SAME data AnalyticsPanel
// already consumed; we just present it in the narrower top-strip slot and
// drop the GEO gaps card (those are surfaced inside the GEO agent drill-down
// now).
import type { Proposal } from "@/lib/supabase/types";

export function GraphsPanel({ proposals }: { proposals: Proposal[] }) {
  const summary = proposals.find((p) => p.type === "audit_summary");
  const offline = proposals.find((p) => p.type === "engine_offline");
  const score = summary
    ? (summary.payload as { score?: number }).score
    : undefined;
  const grade = summary
    ? (summary.payload as { grade?: string }).grade
    : undefined;
  const byCategory = summary
    ? (summary.payload as {
        byCategory?: Record<string, { label: string; issues: number; penalty: number }>;
      }).byCategory
    : undefined;

  return (
    <section className="panel flex h-full flex-col">
      <div className="panel-header">
        <span>Graphs</span>
        <div className="flex items-center gap-2 text-[12px] text-ink-3">
          <span className="chip">SEO</span>
          <span className="chip">GEO</span>
        </div>
      </div>
      <div className="flex-1 space-y-3 p-5">
        {offline && (
          <div className="rounded-md border border-line bg-card-2 p-3 text-[12px] text-warn">
            <strong>{offline.title}</strong>
            <div className="mt-1 text-ink-3">{offline.summary}</div>
          </div>
        )}

        <ScoreCard score={score} grade={grade} />
        <CategoryBreakdown byCategory={byCategory} />
        <TrafficPlaceholder />
      </div>
    </section>
  );
}

function ScoreCard({ score, grade }: { score?: number; grade?: string }) {
  return (
    <div className="rounded-md border border-line bg-card-2 p-3">
      <div className="t-eyebrow mb-2">SEO score</div>
      <div className="flex items-baseline gap-3">
        <div className="text-[32px] font-semibold leading-none text-ink">
          {score !== undefined ? score : "—"}
        </div>
        <div className="text-[12px] text-ink-3">
          / 100 {grade && <span className="ml-1 font-mono">{grade}</span>}
        </div>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-bg-3">
        <div
          className="h-1.5 rounded-full bg-ink"
          style={{ width: score !== undefined ? `${score}%` : "0%" }}
        />
      </div>
    </div>
  );
}

function CategoryBreakdown({
  byCategory,
}: {
  byCategory?: Record<string, { label: string; issues: number; penalty: number }>;
}) {
  const entries = byCategory ? Object.values(byCategory) : [];
  return (
    <div className="rounded-md border border-line bg-card-2 p-3">
      <div className="t-eyebrow mb-2">Audit categories</div>
      {entries.length === 0 ? (
        <p className="text-[12px] text-ink-3">Run the SEO agent to populate.</p>
      ) : (
        <ul className="space-y-1.5 text-[12px]">
          {entries.map((c) => (
            <li key={c.label} className="flex items-center justify-between">
              <span className="text-ink-2">{c.label}</span>
              <span className="font-mono text-[11px] text-ink-3">
                {c.issues} issue{c.issues === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Honest placeholder for the traffic trend. No fake chart — the Connect-GA
// wiring is a named follow-up and shouldn't be implied to exist already.
function TrafficPlaceholder() {
  return (
    <div className="rounded-md border border-line bg-card-2 p-3">
      <div className="t-eyebrow mb-2">Traffic trend</div>
      <p className="text-[12px] leading-[1.5] text-ink-3">
        Connect Google Analytics to populate (deferred).
      </p>
    </div>
  );
}
