// Applier — takes the solver's fixes and writes them back into HTML.
// Each fix type matches a solver.type in solver.js. Functions are idempotent:
// re-running over an already-fixed file is a no-op, not a duplicate.

import * as cheerio from "cheerio";

function applyTitle($, value) {
  const tag = $("head > title").first();
  if (tag.length) {
    const before = tag.text();
    if (before.trim() === value.trim()) return { skipped: "title already matches" };
    tag.text(value);
    return { before, after: value };
  }
  $("head").prepend(`<title>${value}</title>\n  `);
  return { before: null, after: value };
}

function applyDescription($, value) {
  const tag = $('meta[name="description"]').first();
  if (tag.length) {
    const before = tag.attr("content") || "";
    if (before === value) return { skipped: "meta description already matches" };
    tag.attr("content", value);
    return { before, after: value };
  }
  $("head").append(`\n  <meta name="description" content="${value.replace(/"/g, "&quot;")}" />`);
  return { before: null, after: value };
}

function applySchema($, value) {
  // Don't blindly add a second JSON-LD block if any exist; let the human decide.
  if ($('script[type="application/ld+json"]').length) {
    return { skipped: "JSON-LD already present (left untouched)" };
  }
  const trimmed = value.trim();
  // Accept either a full <script ...> block or a bare JSON object.
  const block = /^<script/i.test(trimmed)
    ? trimmed
    : `<script type="application/ld+json">\n${trimmed}\n</script>`;
  $("head").append("\n  " + block + "\n");
  return { after: "JSON-LD inserted" };
}

function applyTldr($, value) {
  if ($('[data-autoseo="tldr"]').length) return { skipped: "TL;DR already present" };
  const body = value.replace(/^\s*TL;DR:?\s*/i, "").trim();
  const html = `<p data-autoseo="tldr"><b>In short:</b> ${body}</p>`;
  const h1 = $("h1").first();
  if (h1.length) h1.after("\n" + html);
  else $("body").prepend(html + "\n");
  return { after: "TL;DR inserted after H1" };
}

function applyOg($, value) {
  if ($('meta[property="og:title"]').length) {
    return { skipped: "Open Graph tags already present" };
  }
  // Claude returns multi-line raw <meta> tags; normalize indentation.
  const lines = value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^<meta\s/i.test(l));
  if (!lines.length) return { skipped: "no <meta> lines in OG payload" };
  $("head").append("\n  " + lines.join("\n  ") + "\n");
  return { after: `${lines.length} OG tag(s) inserted` };
}

const HANDLERS = {
  title: applyTitle,
  description: applyDescription,
  schema: applySchema,
  tldr: applyTldr,
  og: applyOg,
};

export function applyFixes(html, fixes) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const applied = [];
  const skipped = [];

  for (const f of fixes || []) {
    const handler = HANDLERS[f.type];
    if (!handler) {
      skipped.push({ type: f.type, reason: "no applier for this fix type" });
      continue;
    }
    try {
      const result = handler($, f.value || "");
      if (result.skipped) skipped.push({ type: f.type, reason: result.skipped });
      else applied.push({ type: f.type, ...result });
    } catch (err) {
      skipped.push({ type: f.type, reason: err.message });
    }
  }

  return { html: $.html(), applied, skipped };
}
