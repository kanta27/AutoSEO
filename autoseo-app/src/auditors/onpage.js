// A3 On-Page Auditor — title, meta description, headings, alt text, content depth.

export function onpageAudit({ $, text }) {
  const f = [];
  const add = (o) => f.push({ agent: "On-Page", category: "on-page", ...o });

  // Title
  const title = ($("head > title").first().text() || "").trim();
  if (!title) {
    add({ id: "title-missing", severity: "critical", title: "Missing <title> tag",
      detail: "The page has no title. This is the single most important on-page SEO element and the headline shown in search results.",
      solver: { type: "title", current: "" } });
  } else if (title.length < 30) {
    add({ id: "title-short", severity: "high", title: `Title is short (${title.length} chars)`,
      detail: "Aim for 30–60 characters. Short titles waste valuable SERP space and ranking signal.",
      evidence: title, solver: { type: "title", current: title } });
  } else if (title.length > 60) {
    add({ id: "title-long", severity: "medium", title: `Title is long (${title.length} chars)`,
      detail: "Titles over ~60 chars get truncated in Google with an ellipsis. Tighten it.",
      evidence: title, solver: { type: "title", current: title } });
  } else {
    add({ id: "title-ok", severity: "good", title: `Title length is healthy (${title.length} chars)`, evidence: title });
  }

  // Meta description
  const desc = ($('meta[name="description"]').attr("content") || "").trim();
  if (!desc) {
    add({ id: "desc-missing", severity: "high", title: "Missing meta description",
      detail: "No meta description. Google may auto-generate a poor snippet. Write a 120–160 char pitch with the primary keyword.",
      solver: { type: "description", current: "" } });
  } else if (desc.length < 80 || desc.length > 165) {
    add({ id: "desc-length", severity: "medium", title: `Meta description length is off (${desc.length} chars)`,
      detail: "Target 120–160 characters so it displays fully without truncation.",
      evidence: desc, solver: { type: "description", current: desc } });
  } else {
    add({ id: "desc-ok", severity: "good", title: `Meta description length is healthy (${desc.length} chars)`, evidence: desc });
  }

  // H1
  const h1s = $("h1").map((_, el) => $(el).text().trim()).get().filter(Boolean);
  if (h1s.length === 0) {
    add({ id: "h1-missing", severity: "high", title: "No <h1> heading",
      detail: "Every page should have exactly one descriptive H1 stating the page topic." });
  } else if (h1s.length > 1) {
    add({ id: "h1-multiple", severity: "medium", title: `Multiple <h1> tags (${h1s.length})`,
      detail: "Use a single H1 for the main topic; demote the rest to H2/H3.", evidence: h1s.join("  |  ") });
  } else {
    add({ id: "h1-ok", severity: "good", title: "Exactly one <h1>", evidence: h1s[0] });
  }

  // Heading hierarchy: do we jump levels?
  const levels = $("h1,h2,h3,h4,h5,h6").map((_, el) => Number(el.tagName[1])).get();
  let skip = false;
  for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) skip = true;
  if (skip) add({ id: "heading-skip", severity: "low", title: "Heading levels skip a level",
    detail: "Headings jump (e.g. H2 → H4). Keep the outline sequential for accessibility and parsing." });

  // Image alt text
  const imgs = $("img").get();
  const noAlt = imgs.filter((el) => !($(el).attr("alt") || "").trim());
  if (imgs.length && noAlt.length) {
    add({ id: "img-alt", severity: noAlt.length > imgs.length / 2 ? "medium" : "low",
      title: `${noAlt.length} of ${imgs.length} images missing alt text`,
      detail: "Alt text helps image search and accessibility. Describe each meaningful image concisely." });
  } else if (imgs.length) {
    add({ id: "img-alt-ok", severity: "good", title: `All ${imgs.length} images have alt text` });
  }

  // Content depth
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 300) {
    add({ id: "thin", severity: "high", title: `Thin content (~${words} words)`,
      detail: "Pages under ~300 words rarely rank for competitive terms. Expand with genuinely useful detail." });
  } else {
    add({ id: "depth-ok", severity: "good", title: `Content depth ~${words} words` });
  }

  // Canonical
  const canonical = $('link[rel="canonical"]').attr("href");
  if (!canonical) {
    add({ id: "canonical-missing", severity: "low", title: "No canonical URL",
      detail: "Add <link rel=\"canonical\"> to consolidate ranking signals and prevent duplicate-content issues." });
  } else {
    add({ id: "canonical-ok", severity: "good", title: "Canonical URL set", evidence: canonical });
  }

  return f;
}