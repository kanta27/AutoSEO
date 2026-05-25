// Per-key fix cache. One JSON file per (apiKey, normalized URL). The cache is
// hot-path: /v1/fixes reads from it on every page load on the customer's site,
// so we want a stale-while-revalidate read pattern (return stale immediately,
// refresh in background).

import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.AUTOSEO_DATA_DIR || "data";
const CACHE_DIR = path.join(DATA_DIR, "fixes");
const TTL_MS =
  (parseInt(process.env.AUTOSEO_CACHE_TTL_HOURS || "24", 10)) * 3600 * 1000;

// Strip query/hash and collapse trailing slashes so /page, /page/, /page?utm=x
// all hit the same cache entry.
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    const p = u.pathname.replace(/\/+$/, "") || "/";
    return u.origin + p;
  } catch {
    return url;
  }
}

function pathFor(apiKey, url) {
  const safe = Buffer.from(normalizeUrl(url)).toString("base64url").slice(0, 180);
  return path.join(CACHE_DIR, apiKey, safe + ".json");
}

export async function get(apiKey, url) {
  try {
    return JSON.parse(await fs.readFile(pathFor(apiKey, url), "utf8"));
  } catch {
    return null;
  }
}

export async function set(apiKey, url, payload) {
  const p = pathFor(apiKey, url);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const entry = { ...payload, url: normalizeUrl(url), cachedAt: new Date().toISOString() };
  await fs.writeFile(p, JSON.stringify(entry, null, 2), "utf8");
  return entry;
}

export function isStale(entry) {
  if (!entry?.cachedAt) return true;
  return Date.now() - Date.parse(entry.cachedAt) > TTL_MS;
}

export async function listForKey(apiKey) {
  try {
    const files = await fs.readdir(path.join(CACHE_DIR, apiKey));
    const out = [];
    for (const f of files) {
      try {
        out.push(JSON.parse(await fs.readFile(path.join(CACHE_DIR, apiKey, f), "utf8")));
      } catch {}
    }
    return out;
  } catch {
    return [];
  }
}
