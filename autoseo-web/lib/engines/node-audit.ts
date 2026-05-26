// Thin client over the existing Node SEO engine (autoseo-app's POST /api/audit).
// The engine returns score+grade, prioritized issues, the GEO sub-audit, and
// (when its own optional ANTHROPIC_API_KEY is set there) AI-written fixes for
// each issue. That engine has not been migrated to MeshAPI yet — see README.
//
// We intentionally do NOT import autoseo-app's modules directly — the engine
// runs in its own process so we can keep the surfaces decoupled and scale them
// independently later.
import "server-only";

export type AuditIssue = {
  id?: string;
  agent?: string;
  category?: string;
  severity: "critical" | "high" | "medium" | "low";
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

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${engineUrl}/api/audit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, withFixes: opts.withFixes ?? true }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Engine returned ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as AuditReport;
  } catch (err: unknown) {
    const e = err as { name?: string; code?: string; cause?: { code?: string } };
    const isConnRefused =
      e?.name === "AbortError" ||
      e?.code === "ECONNREFUSED" ||
      e?.cause?.code === "ECONNREFUSED" ||
      e?.cause?.code === "UND_ERR_SOCKET";
    if (isConnRefused) throw new EngineUnavailableError(engineUrl, err);
    throw err;
  } finally {
    clearTimeout(t);
  }
}
