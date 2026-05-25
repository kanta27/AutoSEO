// crawl_competitor — fetch clean text from a target's homepage + likely
// blog/product index pages. Uses Firecrawl (markdown extraction) when
// FIRECRAWL_API_KEY is set; otherwise falls back to fetch + cheerio with a
// readability-style strip of nav/aside/script/style.
//
// Respects robots.txt (refuses if the site has Disallow: / for User-agent: *)
// and rate-limits to 800ms between page fetches.

import * as cheerio from "cheerio";

const FIRECRAWL = process.env.FIRECRAWL_API_KEY;
const UA = "Mozilla/5.0 (compatible; AutoSEObot/0.1; +https://autoseo.live/bot)";
const PAGE_CAP = 4;
const CANDIDATE_PATHS = ["/", "/blog", "/news", "/products", "/collections", "/pricing"];

function originOf(domainOrUrl) {
  try {
    return new URL(/^https?:/i.test(domainOrUrl) ? domainOrUrl : "https://" + domainOrUrl).origin;
  } catch {
    return null;
  }
}

async function checkRobots(origin) {
  try {
    const r = await fetch(origin + "/robots.txt", { headers: { "User-Agent": UA } });
    if (!r.ok) return { disallowAll: false };
    const text = await r.text();
    return { disallowAll: /user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*(\n|$)/i.test(text) };
  } catch {
    return { disallowAll: false };
  }
}

async function firecrawlScrape(url) {
  const r = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FIRECRAWL}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
  });
  if (!r.ok) throw new Error("Firecrawl HTTP " + r.status);
  const data = await r.json();
  return (data?.data?.markdown || "").slice(0, 12000);
}

async function fetchReadable(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    redirect: "follow",
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const html = await r.text();
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, footer, header, aside, svg").remove();
  return $("body").text().replace(/\s+/g, " ").trim().slice(0, 12000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const crawlCompetitor = {
  name: "crawl_competitor",
  description:
    "Fetch clean text from a competitor's homepage and likely blog/product index pages. " +
    "Returns at most a handful of pages. Use the content to identify new posts, products, or pricing changes.",
  input_schema: {
    type: "object",
    properties: {
      domain: { type: "string", description: "Bare domain like 'acme.com' or full URL." },
    },
    required: ["domain"],
  },
  async execute({ domain }) {
    const origin = originOf(domain);
    if (!origin) return { error: "Invalid domain" };

    const robots = await checkRobots(origin);
    if (robots.disallowAll) return { error: "robots.txt disallows crawling", origin };

    const pages = [];
    for (const p of CANDIDATE_PATHS.slice(0, PAGE_CAP)) {
      const url = origin + p;
      try {
        await sleep(800);
        const content = FIRECRAWL ? await firecrawlScrape(url) : await fetchReadable(url);
        if (content && content.length > 60) pages.push({ url, content });
      } catch (err) {
        pages.push({ url, error: err.message });
      }
    }
    return {
      domain,
      origin,
      engine: FIRECRAWL ? "firecrawl" : "fetch+cheerio",
      pages,
    };
  },
};
