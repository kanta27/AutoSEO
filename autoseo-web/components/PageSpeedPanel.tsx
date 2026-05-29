"use client";

// PageSpeed panel — Mobile + Desktop Lighthouse scores in the top "scores"
// section, plus a Core Web Vitals card with a Mobile/Desktop tab toggle.
//
// Data flow:
//   • The server dashboard passes `initialResult` IF a fresh cache row exists
//     for this URL (≤6h old). When present we render immediately.
//   • When `initialResult` is null we kick off a fetch on mount so the user
//     sees a loading state, not an empty card. The first dashboard load for
//     a brand-new URL therefore takes ~15-30s before scores appear — this is
//     PSI's actual run time, not something we can speed up.
//   • The Refresh button posts { refresh: true } to /api/pagespeed which
//     bypasses the cache.
//
// Failure: render a polite error card with a Retry button. Never throw.

import { useEffect, useRef, useState } from "react";

// Mirror of CachedPageSpeedResult from lib/engines/pagespeed.ts. Duplicated
// (not imported) because that module is server-only and this is "use client".
export type PageSpeedClientResult = {
  url: string;
  fetchedAt: string;
  fromCache: boolean;
  stale?: boolean;
  staleReason?: string;
  mobile: PageSpeedClientStrategy;
  desktop: PageSpeedClientStrategy;
};

type PageSpeedClientStrategy = {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
  coreWebVitals: {
    lcp: ClientVital;
    fcp: ClientVital;
    tbt: ClientVital;
    cls: ClientVital;
  };
};

type ClientVital = { value: number; unit: "s" | "ms" | ""; pass: boolean };

export function PageSpeedPanel({
  url,
  initialResult,
}: {
  url: string;
  initialResult: PageSpeedClientResult | null;
}) {
  const [result, setResult] = useState<PageSpeedClientResult | null>(
    initialResult,
  );
  const [loading, setLoading] = useState(!initialResult);
  const [error, setError] = useState<string | null>(null);
  // Kick off the initial fetch exactly once. We can't put `fetch` directly
  // in the initial state because that's server-side at SSR time.
  const initialFetchStartedRef = useRef(false);

  useEffect(() => {
    if (initialResult) return;
    if (initialFetchStartedRef.current) return;
    initialFetchStartedRef.current = true;
    void fetchResult(false);
    // We intentionally do not depend on `url` here — if the dashboard
    // navigates to a different company the page itself re-renders with a
    // fresh PageSpeedPanel instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchResult(refresh: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pagespeed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, refresh }),
      });
      const j = (await res.json()) as
        | { ok: true; data: PageSpeedClientResult }
        | { ok: false; error: string };
      if (!j.ok) {
        setError(j.error || `Request failed (${res.status})`);
      } else {
        setResult(j.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <ScoresSection
        result={result}
        loading={loading}
        error={error}
        onRetry={() => fetchResult(true)}
        onRefresh={() => fetchResult(true)}
      />
      <CoreWebVitalsSection
        result={result}
        loading={loading}
        error={error}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top section — four score chips × Mobile / Desktop.

function ScoresSection({
  result,
  loading,
  error,
  onRetry,
  onRefresh,
}: {
  result: PageSpeedClientResult | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onRefresh: () => void;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <span>PageSpeed Scores</span>
          {result?.stale ? (
            <span className="chip text-warn" title={result.staleReason ?? ""}>
              cached
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {result ? (
            <span className="font-mono text-[11px] text-ink-3">
              {timeAgo(result.fetchedAt)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="text-[12px] text-ink-3 hover:text-ink hover:underline disabled:cursor-wait disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      <div className="space-y-4 p-5">
        <p className="text-[12px] text-ink-3">
          Lighthouse scores from Google PageSpeed Insights.
        </p>

        {error && !result ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : !result ? (
          <LoadingState />
        ) : (
          <>
            <StrategyRow label="Mobile" strategy={result.mobile} />
            <StrategyRow label="Desktop" strategy={result.desktop} />
            {error && result ? (
              <div className="rounded-md border border-line bg-card-2 p-3 text-[11px] text-warn">
                Refresh failed: {error}. Showing the last cached snapshot.
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function StrategyRow({
  label,
  strategy,
}: {
  label: string;
  strategy: PageSpeedClientStrategy;
}) {
  return (
    <div>
      <div className="t-eyebrow mb-2">{label}</div>
      <div className="grid grid-cols-4 gap-3">
        <ScoreChip score={strategy.performance} label="Perf" />
        <ScoreChip score={strategy.accessibility} label="Acc." />
        <ScoreChip score={strategy.bestPractices} label="BestPr" />
        <ScoreChip score={strategy.seo} label="SEO" />
      </div>
    </div>
  );
}

function ScoreChip({ score, label }: { score: number; label: string }) {
  // Lighthouse's standard tri-band: green ≥90, orange 50-89, red <50.
  // Tailwind's arbitrary colour values keep us off custom chip classes.
  const cls =
    score >= 90
      ? "bg-lime/60 text-[#2a4513]"
      : score >= 50
        ? "bg-gold/60 text-[#5a4900]"
        : "bg-rose text-[#7a2d1a]";
  return (
    <div className="flex flex-col items-center">
      <div
        className={`flex h-16 w-16 items-center justify-center rounded-full text-2xl font-semibold ${cls}`}
      >
        {score}
      </div>
      <div className="mt-1 text-[11px] text-ink-3">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom section — CWV with Mobile/Desktop tab toggle.

function CoreWebVitalsSection({
  result,
  loading,
  error,
}: {
  result: PageSpeedClientResult | null;
  loading: boolean;
  error: string | null;
}) {
  const [tab, setTab] = useState<"mobile" | "desktop">("desktop");

  return (
    <section className="panel">
      <div className="panel-header">
        <span>Core Web Vitals</span>
        <div className="flex items-center gap-1 rounded-full border border-line p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setTab("desktop")}
            className={
              "rounded-full px-3 py-1 transition " +
              (tab === "desktop"
                ? "bg-ink text-white"
                : "text-ink-3 hover:text-ink")
            }
          >
            Desktop
          </button>
          <button
            type="button"
            onClick={() => setTab("mobile")}
            className={
              "rounded-full px-3 py-1 transition " +
              (tab === "mobile"
                ? "bg-ink text-white"
                : "text-ink-3 hover:text-ink")
            }
          >
            Mobile
          </button>
        </div>
      </div>
      <div className="space-y-3 p-5">
        <p className="text-[12px] text-ink-3">Lighthouse lab metrics.</p>

        {!result && loading ? (
          <LoadingState />
        ) : !result && error ? (
          <p className="text-[12px] text-warn">{error}</p>
        ) : !result ? (
          <p className="text-[12px] text-ink-3">No data yet.</p>
        ) : (
          <ul className="space-y-2">
            <VitalRow name="LCP" vital={result[tab].coreWebVitals.lcp} />
            <VitalRow name="FCP" vital={result[tab].coreWebVitals.fcp} />
            <VitalRow name="TBT" vital={result[tab].coreWebVitals.tbt} />
            <VitalRow name="CLS" vital={result[tab].coreWebVitals.cls} />
          </ul>
        )}
      </div>
    </section>
  );
}

function VitalRow({ name, vital }: { name: string; vital: ClientVital }) {
  const dotColor = vital.pass ? "bg-ok" : "bg-warn";
  return (
    <li className="flex items-center justify-between rounded-md border border-line bg-card-2 px-3 py-2 text-[13px]">
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />
        <span className="font-medium text-ink">{name}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[12px] text-ink-2">
          {formatVitalValue(vital)}
        </span>
        <span
          className={
            vital.pass
              ? "chip chip-live"
              : "chip text-warn"
          }
        >
          {vital.pass ? "Pass" : "Fail"}
        </span>
      </div>
    </li>
  );
}

function formatVitalValue(v: ClientVital): string {
  if (v.unit === "s") return `${v.value}s`;
  if (v.unit === "ms") return `${v.value}ms`;
  // CLS — show the raw decimal, three decimals.
  return v.value.toFixed(3);
}

// ---------------------------------------------------------------------------
// States

function LoadingState() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-card-2 p-4 text-[12px] text-ink-3">
      <Spinner />
      <span>
        Running Lighthouse audits — this typically takes 15-30 seconds…
      </span>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-line bg-card-2 p-4">
      <p className="text-[12px] text-warn">
        Couldn&apos;t fetch PageSpeed scores — try again in a moment.
      </p>
      <p className="font-mono text-[11px] leading-[1.4] text-ink-3">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-[12px] text-ink hover:underline"
      >
        Retry →
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-3 w-3 animate-spin rounded-full border border-ink-3 border-t-transparent"
      aria-hidden
    />
  );
}

// "5m ago" / "2h ago" / "3d ago". Same shape as the dashboard's existing
// relative-time helpers — duplicated here to keep the panel self-contained.
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
