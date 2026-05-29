// PageSpeed Insights engine — calls Google's free PSI v5 API for the company's
// root URL (mobile + desktop in parallel) and returns the Lighthouse category
// scores plus the four Core Web Vitals lab metrics.
//
// Two surfaces:
//   • fetchPageSpeed(url)        — raw fetch; bypasses cache, throws on failure.
//   • fetchPageSpeedCached(url)  — reads/writes pagespeed_cache; 6h freshness.
//
// PSI is SLOW (10-30s per strategy) and the public quota is 25k/day without a
// key. Both reasons → cache aggressively. The Refresh action on the dashboard
// calls the uncached variant.
//
// We do NOT throw the cached result. If a fresh fetch fails but a cached one
// exists, callers get the cached row + a `stale` flag so the UI can show
// "cached — refresh failed". That's better UX than a hard error when the
// dashboard still has something useful to render.
import "server-only";

import { supabaseServer } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Public types

export type CoreWebVital = {
  // Display-ready numeric value: LCP/FCP in seconds, TBT in ms, CLS unitless.
  value: number;
  unit: "s" | "ms" | "";
  // Lighthouse considers >=0.9 a "good" score for the audit; we surface the
  // boolean so the UI doesn't need to know the threshold.
  pass: boolean;
};

export type PageSpeedStrategy = {
  performance: number;       // 0-100
  accessibility: number;     // 0-100
  bestPractices: number;     // 0-100
  seo: number;               // 0-100
  coreWebVitals: {
    lcp: CoreWebVital;       // Largest Contentful Paint (s)
    fcp: CoreWebVital;       // First Contentful Paint (s)
    tbt: CoreWebVital;       // Total Blocking Time (ms)
    cls: CoreWebVital;       // Cumulative Layout Shift (unitless)
  };
};

export type PageSpeedResult = {
  url: string;
  fetchedAt: string;         // ISO timestamp
  mobile: PageSpeedStrategy;
  desktop: PageSpeedStrategy;
};

export type CachedPageSpeedResult = PageSpeedResult & {
  // Caller-friendly hint: was this just refetched, or served from cache?
  // The dashboard uses this to render the "Last fetched: 2h ago" label
  // accurately.
  fromCache: boolean;
  // True when the cached value was returned because a fresh fetch failed
  // (vs because the cache was still fresh). The UI can flag this so the
  // user knows the data may be stale but PSI itself is down right now.
  stale?: boolean;
  staleReason?: string;
};

export class PageSpeedError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "PageSpeedError";
  }
}

// ---------------------------------------------------------------------------
// Tunables

const PSI_BASE = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
// PSI's median run is 10-20s but the long tail goes higher. 30s lines up with
// the existing node-audit timeout and is the practical ceiling before we'd
// rather just bail and let the UI offer a Retry.
const PSI_TIMEOUT_MS = 30_000;
const CACHE_TTL_HOURS = 6;
const CACHE_TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000;
// Lighthouse's "good" threshold — used uniformly across category scores and
// per-audit Core Web Vital scores.
const GOOD_SCORE_THRESHOLD = 0.9;

// ---------------------------------------------------------------------------
// Raw fetch — both strategies in parallel.

export async function fetchPageSpeed(url: string): Promise<PageSpeedResult> {
  const normalizedUrl = normalizeUrl(url);
  // Run mobile + desktop concurrently. allSettled would let us return a
  // partial result if one strategy fails, but PSI failures usually mean the
  // target is unreachable from Google's side OR we're rate-limited — both
  // are global, so a partial result would be misleading. Use Promise.all
  // and fail loudly.
  const [mobile, desktop] = await Promise.all([
    fetchOneStrategy(normalizedUrl, "mobile"),
    fetchOneStrategy(normalizedUrl, "desktop"),
  ]);
  return {
    url: normalizedUrl,
    fetchedAt: new Date().toISOString(),
    mobile,
    desktop,
  };
}

async function fetchOneStrategy(
  url: string,
  strategy: "mobile" | "desktop",
): Promise<PageSpeedStrategy> {
  const apiKey = process.env.PAGESPEED_API_KEY;
  // PSI lets us request multiple `category` params on one call — uses less
  // quota than firing four separate audits.
  const params = new URLSearchParams();
  params.set("url", url);
  params.set("strategy", strategy);
  params.append("category", "performance");
  params.append("category", "accessibility");
  params.append("category", "best-practices");
  params.append("category", "seo");
  if (apiKey) params.set("key", apiKey);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PSI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${PSI_BASE}?${params.toString()}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: ctrl.signal,
    });
  } catch (err) {
    // AbortError on timeout, or "fetch failed" with a connectivity cause —
    // either way we couldn't talk to PSI at all.
    const isAbort =
      (err as { name?: string })?.name === "AbortError";
    const msg = isAbort
      ? `PageSpeed Insights (${strategy}) timed out after ${PSI_TIMEOUT_MS / 1000}s.`
      : `PageSpeed Insights (${strategy}) network error: ${
          err instanceof Error ? err.message : String(err)
        }`;
    throw new PageSpeedError(msg);
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    // PSI returns 4xx with a JSON body { error: { message } } on quota/key
    // problems and 5xx when a target URL is unreachable.
    const body = await res.text().catch(() => "");
    throw new PageSpeedError(
      `PageSpeed Insights (${strategy}) returned ${res.status}: ${body.slice(0, 300)}`,
      res.status,
    );
  }

  const json = (await res.json()) as PsiResponse;
  return shapeStrategy(json);
}

// ---------------------------------------------------------------------------
// Cached variant — Supabase-backed.

export async function fetchPageSpeedCached(
  url: string,
  opts: { refresh?: boolean } = {},
): Promise<CachedPageSpeedResult> {
  const normalizedUrl = normalizeUrl(url);
  const sb = supabaseServer();

  // 1) Try cache unless explicitly refreshing.
  let cached: { result: PageSpeedResult; fetched_at: string } | null = null;
  if (!opts.refresh) {
    const { data } = await sb
      .from("pagespeed_cache")
      .select("result, fetched_at")
      .eq("url", normalizedUrl)
      .maybeSingle();
    if (data) {
      cached = data as { result: PageSpeedResult; fetched_at: string };
      const age = Date.now() - new Date(cached.fetched_at).getTime();
      if (age < CACHE_TTL_MS) {
        return { ...cached.result, fromCache: true };
      }
      // Cache row exists but is stale — fall through to refetch.
    }
  } else {
    // Even on explicit refresh, keep a copy around to return if the fetch
    // fails. Better to render slightly-stale data than a crash banner.
    const { data } = await sb
      .from("pagespeed_cache")
      .select("result, fetched_at")
      .eq("url", normalizedUrl)
      .maybeSingle();
    if (data) cached = data as { result: PageSpeedResult; fetched_at: string };
  }

  // 2) Fresh fetch. If it fails AND we have a cached row, return that with
  //    a `stale` flag — UX-friendlier than hard-failing the whole panel.
  let fresh: PageSpeedResult;
  try {
    fresh = await fetchPageSpeed(normalizedUrl);
  } catch (err) {
    if (cached) {
      const reason =
        err instanceof Error ? err.message : "Fresh fetch failed.";
      return {
        ...cached.result,
        fromCache: true,
        stale: true,
        staleReason: reason,
      };
    }
    // No cache, no fresh data → bubble up so the UI can show the error state.
    throw err;
  }

  // 3) Upsert and return.
  try {
    await sb.from("pagespeed_cache").upsert({
      url: normalizedUrl,
      result: fresh,
      fetched_at: fresh.fetchedAt,
    });
  } catch (err) {
    // Cache write failure is non-fatal — the user still gets fresh data this
    // time, the next call will just re-fetch.
    console.warn(
      `[pagespeed] cache upsert failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { ...fresh, fromCache: false };
}

// ---------------------------------------------------------------------------
// Helpers

// Strip a trailing slash and force https; PSI prefers a full URL with scheme.
// We don't drill below the root URL this session.
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

// Minimal subset of the PSI response we actually consume. Defining the full
// shape would be ~hundreds of fields — we only need categories and four audits.
type PsiAudit = {
  score: number | null;       // 0-1 (null when not applicable)
  numericValue?: number;       // raw value in the audit's natural unit
};

type PsiResponse = {
  lighthouseResult?: {
    categories?: {
      performance?: { score: number | null };
      accessibility?: { score: number | null };
      "best-practices"?: { score: number | null };
      seo?: { score: number | null };
    };
    audits?: {
      "largest-contentful-paint"?: PsiAudit;
      "first-contentful-paint"?: PsiAudit;
      "total-blocking-time"?: PsiAudit;
      "cumulative-layout-shift"?: PsiAudit;
    };
  };
};

function shapeStrategy(json: PsiResponse): PageSpeedStrategy {
  const cats = json.lighthouseResult?.categories ?? {};
  const audits = json.lighthouseResult?.audits ?? {};
  return {
    performance: toScore100(cats.performance?.score),
    accessibility: toScore100(cats.accessibility?.score),
    bestPractices: toScore100(cats["best-practices"]?.score),
    seo: toScore100(cats.seo?.score),
    coreWebVitals: {
      lcp: shapeVital(audits["largest-contentful-paint"], "s"),
      fcp: shapeVital(audits["first-contentful-paint"], "s"),
      tbt: shapeVital(audits["total-blocking-time"], "ms"),
      cls: shapeVital(audits["cumulative-layout-shift"], ""),
    },
  };
}

// Lighthouse category scores are 0-1; we expose 0-100 to match how users
// already think about PageSpeed scores. Null → 0 so a malformed response
// renders as "0" rather than crashing.
function toScore100(score: number | null | undefined): number {
  if (score == null) return 0;
  return Math.round(score * 100);
}

function shapeVital(
  audit: PsiAudit | undefined,
  unit: "s" | "ms" | "",
): CoreWebVital {
  const raw = audit?.numericValue ?? 0;
  const score = audit?.score ?? 0;
  let display: number;
  if (unit === "s") {
    // PSI returns LCP/FCP in milliseconds.
    display = Math.round((raw / 1000) * 10) / 10;
  } else if (unit === "ms") {
    display = Math.round(raw);
  } else {
    // CLS — keep three decimals; the metric is between 0 and ~1 and small
    // differences matter.
    display = Math.round(raw * 1000) / 1000;
  }
  return {
    value: display,
    unit,
    pass: score >= GOOD_SCORE_THRESHOLD,
  };
}
