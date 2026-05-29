// Blog-agent signal tools — the "outward look" the agent does before picking a
// topic. All three are READ-ONLY, server-only, and degrade gracefully: missing
// API key, missing data, network failure → return
// `{ ok: true, data: { available: false, reason } }` so the agent keeps going
// without them. None of them ever throw out of `execute`.
//
// Lives separately from `tools/common.ts` so that file doesn't bloat with
// Tavily/news/competitor-RSS logic. The three tools are blog-specific.
import "server-only";

import type { AgentTool } from "../tools";
import { webSearchTool } from "../tools/common";

// ---------------------------------------------------------------------------
// Shared helpers

// Polite read for the competitor-signals tool. 5-second wall clock so a slow
// competitor host can't stall the whole agent step.
const FETCH_TIMEOUT_MS = 5_000;
const COMPETITOR_CAP = 5;
const RECENT_POSTS_PER_COMPETITOR = 5;

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...(init ?? {}),
      signal: ctrl.signal,
      // A real UA so polite scrapers (Cloudflare etc) don't 403 us on principle.
      headers: {
        "user-agent": "AutoSEO-BlogAgent/1.0 (+https://autoseo.live)",
        accept: "application/xml,text/xml,application/rss+xml,text/html;q=0.9,*/*;q=0.8",
        ...((init?.headers as Record<string, string> | undefined) ?? {}),
      },
    });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Naive but dependency-free XML scrape. Sitemaps and RSS both expose the
// fields we want in straightforward `<tag>value</tag>` shapes. We deliberately
// do NOT pull in a parser — keeps the prompt's "no new dep" constraint.
function extractTagValues(xml: string, tag: string): string[] {
  // Match both `<tag>...</tag>` (RSS title/link/pubDate) and the same wrapped
  // in CDATA. Multiline, non-greedy.
  const re = new RegExp(
    `<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${tag}>`,
    "gi",
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const v = (m[1] ?? "").trim();
    if (v) out.push(v);
  }
  return out;
}

// Parse a sitemap.xml into [{ url, lastmod? }]. Sitemaps come in two shapes:
//   • <urlset><url><loc>…</loc><lastmod>…</lastmod></url>…</urlset>
//   • <sitemapindex><sitemap><loc>…</loc></sitemap>…</sitemapindex>
// For the index variant we don't recurse — keep latency bounded. Returns the
// first `cap` entries.
function parseSitemap(
  xml: string,
  cap: number,
): Array<{ url: string; date?: string }> {
  // Slice the body by <url>…</url> blocks so we can pair loc+lastmod per entry.
  const blocks = xml.match(/<url\b[\s\S]*?<\/url>/gi) ?? [];
  const items: Array<{ url: string; date?: string }> = [];
  for (const b of blocks) {
    const loc = extractTagValues(b, "loc")[0];
    const lastmod = extractTagValues(b, "lastmod")[0];
    if (loc) items.push({ url: loc, date: lastmod });
    if (items.length >= cap) break;
  }
  // Sitemap-index fallback: pull <sitemap><loc>...</loc></sitemap> entries.
  if (items.length === 0) {
    const idxBlocks = xml.match(/<sitemap\b[\s\S]*?<\/sitemap>/gi) ?? [];
    for (const b of idxBlocks) {
      const loc = extractTagValues(b, "loc")[0];
      if (loc) items.push({ url: loc });
      if (items.length >= cap) break;
    }
  }
  return items;
}

// Parse an RSS/Atom feed body into [{ title, url, date? }]. Handles both
// <item> (RSS) and <entry> (Atom) shapes. For Atom <link>, we take the href
// attribute; for RSS <link>, the text content.
function parseFeed(
  xml: string,
  cap: number,
): Array<{ title: string; url: string; date?: string }> {
  const itemBlocks =
    xml.match(/<item\b[\s\S]*?<\/item>/gi) ??
    xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ??
    [];
  const items: Array<{ title: string; url: string; date?: string }> = [];
  for (const b of itemBlocks) {
    const title = extractTagValues(b, "title")[0] ?? "";
    // RSS: <link>https://…</link>; Atom: <link href="https://…" />
    let url = extractTagValues(b, "link")[0] ?? "";
    if (!url) {
      const atomLink = b.match(/<link\b[^>]*href=["']([^"']+)["']/i);
      if (atomLink) url = atomLink[1];
    }
    const date =
      extractTagValues(b, "pubDate")[0] ??
      extractTagValues(b, "published")[0] ??
      extractTagValues(b, "updated")[0];
    if (title && url) items.push({ title, url, date });
    if (items.length >= cap) break;
  }
  return items;
}

// Best-effort: try common discovery paths in order, return the first response
// that parses to at least one item. Sitemap and feed parsing are tried
// per-path based on the file type.
async function discoverRecentPosts(
  baseUrl: string,
): Promise<Array<{ title: string; url: string; date?: string }>> {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  // Order matches the prompt: sitemap.xml → /blog → rss.xml → /feed.
  // Sitemap gives us URLs but no titles; /blog gives us HTML we can't usefully
  // parse here, so we keep the RSS/Atom candidates first and fall back.
  const feedCandidates = [
    `${origin}/rss.xml`,
    `${origin}/feed`,
    `${origin}/feed.xml`,
    `${origin}/atom.xml`,
    `${origin}/blog/feed`,
    `${origin}/blog/rss.xml`,
  ];

  for (const candidate of feedCandidates) {
    const res = await fetchWithTimeout(candidate);
    if (!res || !res.ok) continue;
    const text = await res.text().catch(() => "");
    if (!text) continue;
    const items = parseFeed(text, RECENT_POSTS_PER_COMPETITOR);
    if (items.length) return items;
  }

  // Sitemap last — gives us URLs (and lastmod dates) but no titles. Better
  // than nothing for "what did they publish recently."
  const smRes = await fetchWithTimeout(`${origin}/sitemap.xml`);
  if (smRes?.ok) {
    const text = await smRes.text().catch(() => "");
    if (text) {
      const entries = parseSitemap(text, RECENT_POSTS_PER_COMPETITOR);
      return entries.map((e) => ({
        title: e.url.split("/").filter(Boolean).pop() ?? e.url,
        url: e.url,
        date: e.date,
      }));
    }
  }

  return [];
}

// Pluck competitors out of the company row. Migration 0009 added a dedicated
// `companies.competitors` jsonb column (canonical source); pre-0009 rows used
// to store the same data at `profile.competitors`. We prefer the top-level
// field and fall back to the legacy location so older companies keep working.
// Either field has historically also held plain strings or `{name, domain}`
// shapes — be defensive on each entry.
function readCompetitors(
  company: { competitors?: unknown; profile?: Record<string, unknown> },
): Array<{ name: string; url: string }> {
  const topLevel = (company.competitors ?? null) as unknown;
  const legacy = (company.profile?.competitors ?? null) as unknown;
  const raw = Array.isArray(topLevel) && topLevel.length > 0 ? topLevel : legacy;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ name: string; url: string }> = [];
  for (const entry of raw) {
    if (!entry) continue;
    if (typeof entry === "string") {
      // String form: assume it's the domain or URL.
      const url = entry.startsWith("http") ? entry : `https://${entry}`;
      out.push({ name: entry, url });
      continue;
    }
    if (typeof entry === "object") {
      const e = entry as { name?: string; url?: string; domain?: string };
      const url = e.url ?? (e.domain ? `https://${e.domain}` : "");
      const name = e.name ?? e.domain ?? url;
      if (url) out.push({ name, url });
    }
  }
  return out.slice(0, COMPETITOR_CAP);
}

// Pull a usable industry keyword from the company row. Migration 0009
// promoted category to its own column; prefer that, then legacy profile
// fields, then a heuristic on the description (first 6 words).
function inferIndustryKeyword(
  company: {
    category?: string | null;
    profile?: Record<string, unknown>;
    description: string | null;
  },
): string | null {
  const profile = company.profile;
  const candidate =
    (typeof company.category === "string" ? company.category : undefined) ??
    (profile?.category as string | undefined) ??
    (profile?.industry as string | undefined) ??
    (profile?.niche as string | undefined);
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  if (company.description && company.description.trim()) {
    return company.description.split(/\s+/).slice(0, 6).join(" ").trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1) get_news_for_topic — Tavily-backed recent news/articles for a query.

export const getNewsForTopicTool: AgentTool = {
  name: "get_news_for_topic",
  description:
    "Find recent news/articles relevant to a topic. Use this BEFORE picking your " +
    "article topic to surface news hooks (announcements, launches, trending stories). " +
    "Returns { available: false, reason } when the search provider is not configured " +
    "— in that case proceed without a news hook.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Topic/keyword to find news about (e.g. the company's category, product, " +
          "or candidate article subject).",
      },
      max_results: {
        type: "integer",
        description: "Cap on results (1-10). Defaults to 5.",
        minimum: 1,
        maximum: 10,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return {
        ok: true,
        data: {
          available: false,
          reason:
            "TAVILY_API_KEY is not set — proceed without a news hook.",
        },
        log_summary: "tavily not configured",
      };
    }
    const query = String(args.query ?? "").trim();
    if (!query) {
      return { ok: false, data: { error: "Empty query." } };
    }
    const maxResults = Math.max(1, Math.min(10, Number(args.max_results ?? 5)));
    try {
      // topic=news + days=14 narrows Tavily to recent news rather than evergreen
      // pages — exactly what we want for "is anything happening in this space."
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: maxResults,
          topic: "news",
          days: 14,
          include_answer: false,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          ok: false,
          data: { error: `Tavily ${res.status}: ${text.slice(0, 200)}` },
        };
      }
      const j = (await res.json()) as {
        results?: Array<{
          title?: string;
          url?: string;
          content?: string;
          published_date?: string;
          score?: number;
        }>;
      };
      const results = (j.results ?? []).slice(0, maxResults).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        // Tavily returns ISO-ish published_date on the news topic — pass it
        // through verbatim so the agent can weigh recency.
        published_date: r.published_date,
        snippet: (r.content ?? "").slice(0, 400),
      }));
      return {
        ok: true,
        data: { available: true, results },
        log_summary: `news q="${query.slice(0, 60)}" → ${results.length} result(s)`,
      };
    } catch (err) {
      console.error("[agent:tool:get-news-for-topic] error caught:", err);
      if ((err as { cause?: unknown })?.cause) console.error("  cause:", (err as { cause: unknown }).cause);
      if ((err as { stack?: unknown })?.stack) console.error("  stack:", (err as { stack: unknown }).stack);
      // Graceful: report unavailable rather than failing the tool — the agent
      // should still be able to draft something.
      return {
        ok: true,
        data: {
          available: false,
          reason: `News lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        },
        log_summary: "news lookup failed (graceful)",
      };
    }
  },
};

// ---------------------------------------------------------------------------
// 2) get_competitor_signals — best-effort recent posts from each competitor's
// public sitemap / RSS feed.

export const getCompetitorSignalsTool: AgentTool = {
  name: "get_competitor_signals",
  description:
    "Read recent posts published by this company's competitors (from " +
    "companies.profile.competitors). Use this to either avoid duplicating what " +
    "a competitor just covered, or to deliberately go DEEPER on a topic where " +
    "their coverage is shallow. Returns { available: false, reason } when no " +
    "competitors are recorded — in that case skip and proceed.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async (_args, ctx) => {
    const competitors = readCompetitors(ctx.company);
    if (competitors.length === 0) {
      return {
        ok: true,
        data: {
          available: false,
          reason: "No competitors recorded for this company.",
        },
        log_summary: "no competitors",
      };
    }

    // Process competitors in parallel — each has its own 5s timeout, so worst-
    // case wall clock is ~5s for the whole step, not 5 × competitors.
    const settled = await Promise.allSettled(
      competitors.map(async (c) => {
        try {
          const posts = await discoverRecentPosts(c.url);
          return { name: c.name, url: c.url, recent_posts: posts };
        } catch (err) {
          console.error(
            `[agent:tool:get-competitor-signals] competitor "${c.name}" failed:`,
            err,
          );
          return { name: c.name, url: c.url, recent_posts: [] };
        }
      }),
    );

    const competitorsOut = settled.map((s, i) =>
      s.status === "fulfilled"
        ? s.value
        : { name: competitors[i].name, url: competitors[i].url, recent_posts: [] },
    );
    const withSignal = competitorsOut.filter((c) => c.recent_posts.length > 0);

    return {
      ok: true,
      data: { available: true, competitors: competitorsOut },
      log_summary:
        `${competitors.length} competitor(s), ` +
        `${withSignal.length} with recent posts`,
    };
  },
};

// ---------------------------------------------------------------------------
// 3) get_trending_topics_for_industry — light-touch trend signal. v1 just
// runs an internal Tavily query for "latest trends ${category}" via the
// shared webSearchTool. v2 (next session) will plug in Google Trends.

export const getTrendingTopicsForIndustryTool: AgentTool = {
  name: "get_trending_topics_for_industry",
  description:
    "Surface broader trending topics in this company's industry/category. Useful " +
    "as a sanity-check that the chosen article topic aligns with what's hot. " +
    "Returns { available: false, reason } when the company has no category info " +
    "or the search provider isn't configured.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async (_args, ctx) => {
    const keyword = inferIndustryKeyword(ctx.company);
    if (!keyword) {
      return {
        ok: true,
        data: {
          available: false,
          reason: "No category info for this company.",
        },
        log_summary: "no category keyword",
      };
    }
    // Reuse the same Tavily integration the public web_search tool wraps.
    // We don't expose webSearchTool to the LLM twice; we call its execute
    // directly with a curated query.
    const query = `latest trends ${keyword} this week`;
    const inner = await webSearchTool.execute(
      { query, max_results: 5 },
      { agentKey: ctx.agentKey, company: ctx.company, step: ctx.step },
    );
    // webSearchTool already returns a shape compatible with our contract on
    // both "not configured" and "ok" paths. Convert it to trends-shaped data.
    const d = inner.data as
      | { available: false; reason?: string }
      | {
          available: true;
          results: Array<{ title: string; url: string; content: string; score: number }>;
        };
    if (!("available" in d) || d.available === false) {
      return {
        ok: true,
        data: {
          available: false,
          reason:
            (d as { reason?: string }).reason ??
            "Search provider not configured — proceed without trend signal.",
        },
        log_summary: "trends unavailable",
      };
    }
    const trends = d.results.slice(0, 5).map((r) => ({
      topic: r.title,
      source_url: r.url,
      snippet: r.content,
    }));
    return {
      ok: true,
      data: { available: true, trends },
      log_summary: `trends for "${keyword.slice(0, 40)}" → ${trends.length}`,
    };
  },
};
