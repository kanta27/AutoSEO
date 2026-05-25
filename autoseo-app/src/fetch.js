// Page fetcher — the input layer for the audit swarm (spec §3.1 "Crawler").
// Fetches a URL server-side (no CORS limits), records the redirect chain,
// status, timing and content-type, then grabs robots.txt for the host.

const UA =
  "Mozilla/5.0 (compatible; AutoSEObot/0.1; +https://autoseo.live/bot)";

function normalizeUrl(raw) {
  let u = (raw || "").trim();
  if (!u) throw new Error("No URL provided.");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  const parsed = new URL(u); // throws if invalid
  return parsed.toString();
}

async function timedFetch(url, opts = {}) {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      ...opts,
    });
    return { res, ms: Date.now() - start };
  } finally {
    clearTimeout(timeout);
  }
}

// Follow redirects manually so we can report the chain (spec A2 "redirect chains").
async function fetchPage(rawUrl) {
  const startUrl = normalizeUrl(rawUrl);
  const chain = [];
  let current = startUrl;
  let finalRes = null;
  let totalMs = 0;

  for (let hop = 0; hop < 6; hop++) {
    const { res, ms } = await timedFetch(current);
    totalMs += ms;
    const status = res.status;
    const location = res.headers.get("location");

    if (status >= 300 && status < 400 && location) {
      const next = new URL(location, current).toString();
      chain.push({ url: current, status, to: next });
      current = next;
      continue;
    }
    chain.push({ url: current, status });
    finalRes = res;
    break;
  }

  if (!finalRes) throw new Error("Too many redirects (>6 hops).");

  const contentType = finalRes.headers.get("content-type") || "";
  const html = await finalRes.text();
  const parsed = new URL(current);

  return {
    requestedUrl: startUrl,
    finalUrl: current,
    origin: parsed.origin,
    host: parsed.host,
    status: finalRes.status,
    contentType,
    https: parsed.protocol === "https:",
    redirectChain: chain,
    redirects: Math.max(0, chain.length - 1),
    timeMs: totalMs,
    bytes: Buffer.byteLength(html, "utf8"),
    headers: Object.fromEntries(finalRes.headers.entries()),
    html,
  };
}

async function fetchRobots(origin) {
  try {
    const { res } = await timedFetch(origin + "/robots.txt");
    if (res.status !== 200) return { ok: false, status: res.status };
    const text = await res.text();
    const sitemaps = [...text.matchAll(/sitemap:\s*(\S+)/gi)].map((m) => m[1]);
    const disallowAll = /user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*(\n|$)/i.test(
      text
    );
    return { ok: true, status: 200, sitemaps, disallowAll, raw: text.slice(0, 2000) };
  } catch {
    return { ok: false, status: 0 };
  }
}

export { fetchPage, fetchRobots, normalizeUrl };