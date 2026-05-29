// Thin client over the existing Node SEO engine (autoseo-app's POST /api/audit).
// The engine returns score+grade, prioritized issues, the GEO sub-audit, and
// (when its own optional ANTHROPIC_API_KEY is set there) AI-written fixes for
// each issue. That engine uses its own provider independently of this app —
// out of scope here.
//
// We intentionally do NOT import autoseo-app's modules directly — the engine
// runs in its own process so we can keep the surfaces decoupled and scale them
// independently later.
import "server-only";

// The Node engine emits findings at every severity tier including "good"
// (wins): see `autoseo-app/src/auditors/geo.js`'s `geo-tldr-ok` etc. The
// type previously claimed only the four-tier bad ladder, which was a lie
// that downstream consumers tripped over (e.g. proposals.ts had to cast
// to drop "good"). Widening the union here is honest and lets each
// consumer pick its own severity policy without casts.
export type AuditIssue = {
  id?: string;
  agent?: string;
  category?: string;
  severity: "critical" | "high" | "medium" | "low" | "good";
  severityLabel?: string;
  title: string;
  detail?: string;
  evidence?: string;
  score?: number;
  solver?: { type: string; current?: string; hint?: string };
};

export type AuditFix = {
  type: string;
  value: string;
  rationale?: string;
  findingId?: string;
};

export type GeoSubReport = {
  cited_queries?: Array<{ query: string; cited_url?: string | null }>;
  uncited_queries?: string[];
  geo_readiness_score?: number;
  citable_gaps?: Array<{ topic: string; gap_type: string; suggested_addition: string }>;
  competitor_citation_share?: Record<string, number>;
} | null;

export type AuditReport = {
  meta: {
    requestedUrl: string;
    finalUrl: string;
    status: number;
    title?: string;
    fetchedAt: string;
  };
  score: number;
  grade: string;
  counts: Record<string, number>;
  byCategory?: Record<string, { label: string; issues: number; wins: number; penalty: number }>;
  issues: AuditIssue[];
  wins?: unknown[];
  solutions?: { engine: string; fixes: AuditFix[] };
  // The audit pipeline doesn't expose A10 directly; the Node app's geo auditor
  // populates findings under category=geo. We carry an optional geo block for
  // when the Python swarm result is merged in later.
  geo?: GeoSubReport;
};

export class EngineUnavailableError extends Error {
  constructor(public engineUrl: string, cause?: unknown) {
    super(
      `Node audit engine at ${engineUrl} is unreachable. Start it with: ` +
        `cd autoseo-app && npm start  (default port 3000)`
    );
    this.name = "EngineUnavailableError";
    if (cause) (this as { cause?: unknown }).cause = cause;
  }
}

const DEFAULT_ENGINE = process.env.NODE_ENGINE_URL || "http://localhost:3000";
const DEFAULT_TIMEOUT_MS = Number(process.env.NODE_ENGINE_TIMEOUT_MS || 30_000);

export async function runNodeAudit(
  url: string,
  opts: { withFixes?: boolean; engineUrl?: string; timeoutMs?: number } = {}
): Promise<AuditReport> {
  const engineUrl = opts.engineUrl || DEFAULT_ENGINE;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    return await fetchAudit(engineUrl, url, opts.withFixes ?? true, timeoutMs);
  } catch (err) {
    // Only retry on connection-level failures (the engine wasn't reachable at
    // all), not on HTTP errors from a reachable engine. The retry swaps the
    // loopback form only — never touches non-loopback hosts.
    if (!isConnectivityError(err)) throw err;
    const alt = swapLoopbackHost(engineUrl);
    if (!alt) {
      throw new EngineUnavailableError(engineUrl, err);
    }
    try {
      const report = await fetchAudit(alt, url, opts.withFixes ?? true, timeoutMs);
      // One-line notice so the user can fix their env if they want, but not
      // shouting since the fallback worked.
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          `[engine] connected via fallback host (${new URL(alt).host}). Consider switching NODE_ENGINE_URL.`,
        );
      }
      return report;
    } catch (fallbackErr) {
      // Both addresses unreachable → the engine really is down.
      if (isConnectivityError(fallbackErr)) {
        throw new EngineUnavailableError(engineUrl, fallbackErr);
      }
      throw fallbackErr;
    }
  }
}

// Single-attempt fetch. Throws on connectivity OR HTTP errors; the wrapper
// distinguishes them and only retries on connectivity.
async function fetchAudit(
  engineUrl: string,
  url: string,
  withFixes: boolean,
  timeoutMs: number,
): Promise<AuditReport> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${engineUrl}/api/audit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, withFixes }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // Tag with the status so the retry guard can tell HTTP errors from
      // connectivity errors. HTTP errors are real, not "engine down".
      throw Object.assign(new Error(`Engine returned ${res.status}: ${body.slice(0, 200)}`), {
        httpStatus: res.status,
      });
    }
    return (await res.json()) as AuditReport;
  } finally {
    clearTimeout(t);
  }
}

// True when the error suggests the engine wasn't reachable at all, vs. it
// was reached and returned a 4xx/5xx. Covers Node 18+ fetch's nested cause
// shape, the legacy code/codes, AbortError on connect timeouts, and the
// fetch's bare "fetch failed" message.
function isConnectivityError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    name?: string;
    code?: string;
    httpStatus?: number;
    message?: string;
    cause?: { code?: string; errno?: string };
  };
  // If we tagged it as an HTTP error (above), it's NOT a connectivity error.
  if (typeof e.httpStatus === "number") return false;
  if (e.name === "AbortError") return true;
  const connCodes = new Set([
    "ECONNREFUSED",
    "ENETUNREACH",
    "EAI_AGAIN",
    "ENOTFOUND",
    "EHOSTUNREACH",
    "ETIMEDOUT",
    "UND_ERR_SOCKET",
    "UND_ERR_CONNECT_TIMEOUT",
  ]);
  if (e.code && connCodes.has(e.code)) return true;
  if (e.cause?.code && connCodes.has(e.cause.code)) return true;
  // Node 18+ fetch surfaces "fetch failed" with the real reason on .cause.
  // If we couldn't read a code but message is the bare "fetch failed", treat
  // as connectivity (matches the symptom we're fixing).
  if (e.message === "fetch failed" || e.message?.startsWith("fetch failed")) return true;
  return false;
}

// Returns the URL with the loopback host swapped to its alternate form, or
// null if the host isn't a loopback (no fallback is meaningful for those).
function swapLoopbackHost(engineUrl: string): string | null {
  try {
    const u = new URL(engineUrl);
    if (u.hostname === "127.0.0.1") {
      u.hostname = "localhost";
      return u.toString().replace(/\/$/, "");
    }
    if (u.hostname === "localhost") {
      u.hostname = "127.0.0.1";
      return u.toString().replace(/\/$/, "");
    }
    return null;
  } catch {
    return null;
  }
}
