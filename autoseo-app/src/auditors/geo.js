// A10 GEO / LLM-Visibility Auditor — how citable the page is to AI answer engines.
// Spec §1.2: 44.2% of LLM citations come from the first 30% of text → front-load
// answers, add TL;DRs, quotable stats, Q&A blocks, and clear authorship.

export function geoAudit({ $, text }) {
  const f = [];
  const add = (o) => f.push({ agent: "GEO", category: "geo", ...o });

  const words = text.split(/\s+/).filter(Boolean);
  const first30 = words.slice(0, Math.max(40, Math.round(words.length * 0.3))).join(" ");

  // Answer-first / TL;DR
  const hasTldr = /\b(tl;dr|in short|key takeaway|summary:|short answer)\b/i.test(first30);
  if (!hasTldr) {
    add({ id: "geo-tldr", severity: "medium", title: "No answer-first summary near the top",
      detail: "AI engines lift concise, self-contained answers from the opening. Add a TL;DR / direct answer in the first paragraph.",
      solver: { type: "tldr", current: first30.slice(0, 600) } });
  } else {
    add({ id: "geo-tldr-ok", severity: "good", title: "Answer-first summary detected near the top" });
  }

  // Citable statistics in the first 30%
  const statsTop = (first30.match(/\b\d[\d,.]*\s?(%|percent|x|million|billion|k\b)/gi) || []).length;
  if (statsTop === 0) {
    add({ id: "geo-stats", severity: "low", title: "No quotable statistics in the opening",
      detail: "Concrete numbers and percentages get cited. Lead with a verifiable stat where the topic allows." });
  } else {
    add({ id: "geo-stats-ok", severity: "good", title: `${statsTop} quotable stat(s) in the opening` });
  }

  // Q&A structure
  const questionHeads = $("h2,h3").filter((_, el) => /\?$/.test($(el).text().trim())).length;
  if (questionHeads < 1) {
    add({ id: "geo-qa", severity: "low", title: "No question-style headings",
      detail: "Phrase some headings as the questions users actually ask. Q&A blocks map directly to AI prompts and PAA results." });
  } else {
    add({ id: "geo-qa-ok", severity: "good", title: `${questionHeads} question-style heading(s)` });
  }

  // Scannable structure (lists / tables are easy to cite)
  const lists = $("ul,ol").length;
  const tables = $("table").length;
  if (lists + tables === 0) {
    add({ id: "geo-structure", severity: "low", title: "No lists or tables",
      detail: "Structured lists and comparison tables are disproportionately quoted by AI engines. Add them where it fits." });
  } else {
    add({ id: "geo-structure-ok", severity: "good", title: `Scannable structure (${lists} lists, ${tables} tables)` });
  }

  // E-E-A-T signals: author + date
  const hasAuthor =
    $('[rel="author"], [itemprop="author"], .author, .byline').length > 0 ||
    /\bby\s+[A-Z][a-z]+/.test(text.slice(0, 1500));
  const hasDate =
    $("time[datetime], [itemprop='datePublished'], [property='article:published_time']").length > 0;
  if (!hasAuthor) {
    add({ id: "geo-author", severity: "low", title: "No clear author / byline",
      detail: "Visible authorship is an E-E-A-T trust signal that both Google and AI engines weigh." });
  }
  if (!hasDate) {
    add({ id: "geo-date", severity: "low", title: "No published/updated date",
      detail: "Surface a publish or updated date. Freshness influences ranking and whether AI engines trust the page." });
  }

  return f;
}
