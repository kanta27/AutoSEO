// POST /api/pagespeed  { url: string, refresh?: boolean }
//   → { ok: true, data: CachedPageSpeedResult } on success
//   → { ok: false, error: string, status?: number } on failure
//
// Reads Lighthouse data from Google PSI (cached 6h in pagespeed_cache).
// Not secret-gated — it's public Lighthouse data and PSI's own quota is the
// rate limiter. Anyone with dashboard access can refresh.
import { fetchPageSpeedCached, PageSpeedError } from "@/lib/engines/pagespeed";

export const runtime = "nodejs";
// PSI fetches can take 30+ seconds (slow target + 30s per-strategy timeout +
// occasional retries). The Next 14 default of 60s per route is enough; this
// explicit value documents the expectation.
export const maxDuration = 60;

type Body = { url?: unknown; refresh?: unknown };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body." });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return json(400, { ok: false, error: "Provide a `url` string." });
  }
  // Reject obviously-malformed URLs up front so we don't waste a PSI call.
  try {
    new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return json(400, { ok: false, error: `Not a valid URL: ${url}` });
  }

  const refresh = body.refresh === true;

  try {
    const result = await fetchPageSpeedCached(url, { refresh });
    return json(200, { ok: true, data: result });
  } catch (err) {
    if (err instanceof PageSpeedError) {
      // Surface the PSI status (often 429 for quota, 4xx for invalid keys,
      // 5xx for unreachable targets) so the UI can choose a useful message.
      return json(502, {
        ok: false,
        error: err.message,
        status: err.status,
      });
    }
    console.error("[api:pagespeed] unexpected error:", err);
    return json(500, {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error.",
    });
  }
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
