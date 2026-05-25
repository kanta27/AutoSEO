// Orchestrator — the Planner (spec §3.3). Runs the pipeline:
//   fetch → parse → audit swarm → prioritize → solver swarm → report.

import * as cheerio from "cheerio";
import { fetchPage, fetchRobots } from "./fetch.js";
import { onpageAudit } from "./auditors/onpage.js";
import { technicalAudit } from "./auditors/technical.js";
import { schemaAudit } from "./auditors/schema.js";
import { geoAudit } from "./auditors/geo.js";
import { socialAudit } from "./auditors/social.js";
import { prioritize } from "./prioritize.js";
import { solve } from "./solver.js";
import { generateFixScript } from "./generator.js";

function extractText($) {
  const $clone = cheerio.load($.html());
  $clone("script, style, noscript, template, svg").remove();
  return $clone("body").text().replace(/\s+/g, " ").trim();
}

export async function runAudit(input, { withFixes = true } = {}) {
  // Two modes: URL (fetch + audit) or local HTML (audit raw markup from a file).
  if (typeof input === "string") input = { url: input };

  let page, $, robots;
  if (input.html != null) {
    const htmlStr = input.html;
    page = {
      requestedUrl: input.sourceUrl || "file://local",
      finalUrl: input.sourceUrl || "file://local",
      origin: "file://local",
      host: "local",
      status: 200,
      contentType: "text/html",
      https: true, // local files aren't penalized for missing TLS
      redirectChain: [],
      redirects: 0,
      timeMs: 0,
      bytes: Buffer.byteLength(htmlStr, "utf8"),
      headers: {},
      html: htmlStr,
    };
    $ = cheerio.load(htmlStr);
    robots = null;
  } else {
    page = await fetchPage(input.url);
    if (!/text\/html/i.test(page.contentType)) {
      throw new Error(
        `URL returned "${page.contentType || "unknown content-type"}", not an HTML page.`
      );
    }
    $ = cheerio.load(page.html);
    robots = await fetchRobots(page.origin);
  }
  const text = extractText($);

  const parsed = {
    title: ($("head > title").first().text() || "").trim(),
    description: ($('meta[name="description"]').attr("content") || "").trim(),
    h1: ($("h1").first().text() || "").trim(),
    text,
  };

  const ctx = { $, page, robots, text };
  const findings = [
    ...onpageAudit(ctx),
    ...technicalAudit(ctx),
    ...schemaAudit(ctx),
    ...geoAudit(ctx),
    ...socialAudit(ctx),
  ];

  const report = prioritize(findings);

  let solutions = { engine: "skipped", fixes: [] };
  if (withFixes) {
    solutions = await solve(report.issues, page, parsed);
    if (solutions.fixes?.length) {
      solutions.downloadScript = await generateFixScript({
        url: page.finalUrl,
        fixes: solutions.fixes,
      });
    }
  }

  return {
    meta: {
      requestedUrl: page.requestedUrl,
      finalUrl: page.finalUrl,
      status: page.status,
      https: page.https,
      redirects: page.redirects,
      timeMs: page.timeMs,
      sizeKb: Math.round(page.bytes / 1024),
      title: parsed.title,
      fetchedAt: new Date().toISOString(),
    },
    ...report,
    solutions,
  };
}
