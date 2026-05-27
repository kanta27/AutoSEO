// Tiny markdown → HTML converter used by every publish connector AND by the
// dashboard's "Copy HTML" manual-mode button. Pure compute (no secrets, no
// IO) so it's safe on both server and client — deliberately NOT marked
// `server-only`.
//
// The blog agent's output uses a constrained subset (paragraphs, h2/h3,
// bullets, bold/italic, links) so a ~40-line converter is enough. Anything
// fancier (tables, code blocks) would justify a real markdown library;
// until then, no new dep.

export function markdownToBasicHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) {
      closeList();
      out.push(`<h2>${inline(h2[1])}</h2>`);
      continue;
    }
    const h3 = line.match(/^###\s+(.+)/);
    if (h3) {
      closeList();
      out.push(`<h3>${inline(h3[1])}</h3>`);
      continue;
    }
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) {
      // Article title goes in the connector's `title` field separately —
      // render leading H1s as H2 so the published page doesn't end up with
      // two H1s.
      closeList();
      out.push(`<h2>${inline(h1[1])}</h2>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)/);
    if (bullet) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[(.+?)\]\((https?:[^\s)]+)\)/g, '<a href="$2">$1</a>');
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
