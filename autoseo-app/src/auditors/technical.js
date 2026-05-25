// A1/A2 Technical Auditor — HTTPS, status, redirects, indexability, viewport, perf signals.

export function technicalAudit({ $, page, robots }) {
  const f = [];
  const add = (o) => f.push({ agent: "Technical", category: "technical", ...o });

  // HTTPS
  if (!page.https) {
    add({ id: "https", severity: "critical", title: "Site is not served over HTTPS",
      detail: "HTTPS is a confirmed ranking signal and required for modern browser features. Install a TLS certificate." });
  } else {
    add({ id: "https-ok", severity: "good", title: "Served over HTTPS" });
  }

  // Status
  if (page.status !== 200) {
    add({ id: "status", severity: "critical", title: `Final status ${page.status}`,
      detail: "The page did not return 200 OK. Search engines may drop it from the index." });
  }

  // Redirect chain
  if (page.redirects >= 2) {
    add({ id: "redirect-chain", severity: "medium", title: `Redirect chain of ${page.redirects} hops`,
      detail: "Each hop loses a little link equity and slows the page. Point links straight at the final URL.",
      evidence: page.redirectChain.map((h) => `${h.status} ${h.url}`).join("  →  ") });
  } else if (page.redirects === 1) {
    add({ id: "redirect-one", severity: "low", title: "One redirect before final URL",
      detail: "A single redirect is usually fine, but link directly to the destination where you can." });
  }

  // Indexability
  const metaRobots = ($('meta[name="robots"]').attr("content") || "").toLowerCase();
  if (metaRobots.includes("noindex")) {
    add({ id: "noindex", severity: "critical", title: "Page is set to noindex",
      detail: "A <meta name=\"robots\" content=\"noindex\"> tag tells search engines to exclude this page. Remove it if the page should rank.",
      evidence: metaRobots });
  }
  if (robots?.disallowAll) {
    add({ id: "robots-block", severity: "high", title: "robots.txt disallows all crawlers",
      detail: "robots.txt contains a blanket Disallow: / for User-agent: *. Crawlers can't fetch the site." });
  }

  // Viewport (mobile)
  if (!$('meta[name="viewport"]').length) {
    add({ id: "viewport", severity: "high", title: "No mobile viewport meta tag",
      detail: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> for mobile-friendliness, a ranking factor." });
  } else {
    add({ id: "viewport-ok", severity: "good", title: "Mobile viewport configured" });
  }

  // Lang
  if (!$("html").attr("lang")) {
    add({ id: "lang", severity: "low", title: "No lang attribute on <html>",
      detail: "Set <html lang=\"en\"> (or the right locale) for accessibility and correct international targeting." });
  }

  // Charset
  if (!$("meta[charset]").length && !/charset/i.test($('meta[http-equiv="Content-Type"]').attr("content") || "")) {
    add({ id: "charset", severity: "low", title: "No charset declaration",
      detail: "Declare <meta charset=\"utf-8\"> early in <head> to avoid encoding glitches." });
  }

  // Weight / speed proxy (no Lighthouse, but flag obvious bloat)
  const kb = Math.round(page.bytes / 1024);
  if (kb > 600) {
    add({ id: "weight", severity: "medium", title: `Large HTML document (${kb} KB)`,
      detail: "The HTML alone is heavy. Trim inline scripts/markup; large documents hurt Core Web Vitals." });
  }
  if (page.timeMs > 2500) {
    add({ id: "slow", severity: "medium", title: `Slow server response (${page.timeMs} ms)`,
      detail: "Time-to-fetch is high. Improve TTFB via caching/CDN — speed is a ranking and UX signal." });
  }

  // Sitemap
  if (robots?.ok && (!robots.sitemaps || robots.sitemaps.length === 0)) {
    add({ id: "sitemap", severity: "low", title: "No sitemap referenced in robots.txt",
      detail: "Add a Sitemap: line to robots.txt so crawlers discover all your URLs efficiently." });
  } else if (robots?.sitemaps?.length) {
    add({ id: "sitemap-ok", severity: "good", title: "Sitemap declared in robots.txt", evidence: robots.sitemaps.join(", ") });
  }

  return f;
}