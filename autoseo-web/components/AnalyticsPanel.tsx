// Center panel — renders the latest SEO audit_summary + GEO citable gaps from
// the proposals stream. Real GSC/GA wiring is a follow-up session, so the
// "chart" slots are placeholder cards labeled with the connect CTA.
import type { Proposal } from "@/lib/supabase/types";

export function AnalyticsPanel({ proposals }: { proposals: Proposal[] }) {
  const summary = proposals.find((p) => p.type === "audit_summary");
  const offline = proposals.find((p) => p.type === "engine_offline");
  const geoGaps = proposals.filter((p) => p.type === "geo_gap").slice(0, 3);

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
    <section className="panel flex flex-col">
      <div className="panel-header">
        <span>Analytics</span>
        <div className="flex items-center gap-2 text-[12px] text-ink-3">
          <span className="chip">SEO</span>
          <span className="chip">GEO</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
        {offline && (
          <div className="md:col-span-2 rounded-md border border-line bg-card-2 p-4 text-[13px] text-warn">
            <strong>{offline.title}</strong>
            <div className="mt-1 text-ink-3">{offline.summary}</div>
          </div>
        )}

        <ScoreCard label="SEO score" value={score} grade={grade} />
        <ConnectCard label="Google Analytics" />
        <CategoryBreakdown byCategory={byCategory} />
        <GeoGapsCard gaps={geoGaps} />
      </div>
    </section>
  );
}

function ScoreCard({
  label,
  value,
  grade,
}: {
  label: string;
  value?: number;
  grade?: string;
}) {
  return (
    <div className="rounded-md border border-line bg-card-2 p-4">
      <div className="t-eyebrow mb-2">{label}</div>
      <div className="flex items-baseline gap-3">
        <div className="text-[40px] font-semibold text-ink">
          {value !== undefined ? value : "—"}
        </div>
        <div className="text-[14px] text-ink-3">
          / 100 {grade && <span className="ml-2 font-mono">{grade}</span>}
        </div>
      </div>
      <div className="mt-3 h-2 rounded-full bg-bg-3">
        <div
          className="h-2 rounded-full bg-ink"
          style={{ width: value !== undefined ? `${value}%` : "0%" }}
        />
      </div>
    </div>
  );
}

function ConnectCard({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-start justify-between rounded-md border border-line bg-card-2 p-4">
      <div>
        <div className="t-eyebrow mb-2">{label}</div>
        <p className="text-[12px] text-ink-3">
          Connect for real traffic + ranking data (deferred to a later session).
        </p>
      </div>
      <button type="button" className="btn mt-3 cursor-not-allowed opacity-60" disabled>
        Connect
      </button>
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
    <div className="rounded-md border border-line bg-card-2 p-4">
      <div className="t-eyebrow mb-3">Audit categories</div>
      {entries.length === 0 ? (
        <p className="text-[12px] text-ink-3">Run the SEO agent to populate.</p>
      ) : (
        <ul className="space-y-2 text-[13px]">
          {entries.map((c) => (
            <li key={c.label} className="flex items-center justify-between">
              <span>{c.label}</span>
              <span className="font-mono text-[12px] text-ink-3">
                {c.issues} issue{c.issues === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GeoGapsCard({ gaps }: { gaps: Proposal[] }) {
  return (
    <div className="rounded-md border border-line bg-card-2 p-4">
      <div className="t-eyebrow mb-3">GEO citable gaps</div>
      {gaps.length === 0 ? (
        <p className="text-[12px] text-ink-3">No gaps detected yet.</p>
      ) : (
        <ul className="space-y-2 text-[13px]">
          {gaps.map((g) => (
            <li key={g.id}>
              <div className="font-medium text-ink">{g.title}</div>
              <div className="text-[12px] text-ink-3">{g.summary}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
