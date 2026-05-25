// A4 Schema Auditor — JSON-LD structured data presence, validity, and type coverage.

export function schemaAudit({ $ }) {
  const f = [];
  const add = (o) => f.push({ agent: "Schema", category: "schema", ...o });

  const blocks = $('script[type="application/ld+json"]').get();
  if (blocks.length === 0) {
    add({ id: "schema-missing", severity: "high", title: "No JSON-LD structured data",
      detail: "Structured data unlocks rich results (FAQ, breadcrumbs, ratings) and helps AI engines understand the page. Add schema.org JSON-LD.",
      solver: { type: "schema", current: "" } });
    return f;
  }

  const types = new Set();
  let invalid = 0;
  for (const el of blocks) {
    const raw = $(el).contents().text();
    try {
      const json = JSON.parse(raw);
      const arr = Array.isArray(json) ? json : json["@graph"] || [json];
      for (const node of arr) {
        const t = node && node["@type"];
        if (t) (Array.isArray(t) ? t : [t]).forEach((x) => types.add(x));
      }
    } catch {
      invalid++;
    }
  }

  if (invalid) {
    add({ id: "schema-invalid", severity: "high", title: `${invalid} JSON-LD block(s) fail to parse`,
      detail: "Invalid JSON-LD is ignored by search engines and may suppress rich results. Validate with Google's Rich Results Test." });
  }

  if (types.size) {
    add({ id: "schema-ok", severity: "good", title: `Structured data present`,
      detail: `Detected types: ${[...types].join(", ")}.`, evidence: [...types].join(", ") });
  }

  // Opportunity hints
  const hasFaq = $("h2,h3").filter((_, el) => /\?$/.test($(el).text().trim())).length >= 2;
  if (hasFaq && !types.has("FAQPage")) {
    add({ id: "schema-faq-op", severity: "medium", title: "Page looks like a FAQ but has no FAQPage schema",
      detail: "Questions in headings detected. Adding FAQPage JSON-LD can win an expandable FAQ rich result.",
      solver: { type: "schema", current: "", hint: "FAQPage" } });
  }

  return f;
}