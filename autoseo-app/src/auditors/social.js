// Social / sharing auditor — Open Graph + Twitter cards (how the page looks when shared).

export function socialAudit({ $ }) {
  const f = [];
  const add = (o) => f.push({ agent: "Social", category: "social", ...o });

  const og = (p) => $(`meta[property="og:${p}"]`).attr("content");
  const missing = ["title", "description", "image"].filter((p) => !og(p));

  if (missing.length === 3) {
    add({ id: "og-missing", severity: "medium", title: "No Open Graph tags",
      detail: "Without og:title / og:description / og:image, links shared on social and chat apps render as bare URLs.",
      solver: { type: "og", current: "" } });
  } else if (missing.length) {
    add({ id: "og-partial", severity: "low", title: `Open Graph incomplete (missing og:${missing.join(", og:")})`,
      detail: "Fill in the remaining Open Graph tags so shared links show a rich preview card." });
  } else {
    add({ id: "og-ok", severity: "good", title: "Open Graph tags complete" });
  }

  if (!$('meta[name="twitter:card"]').length) {
    add({ id: "twitter", severity: "low", title: "No Twitter/X card tag",
      detail: "Add <meta name=\"twitter:card\" content=\"summary_large_image\"> for a large preview on X." });
  }

  return f;
}
