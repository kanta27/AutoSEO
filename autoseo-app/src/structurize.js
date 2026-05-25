// Transforms the solver's flat fix array (each with {type, value} where value
// is raw HTML/text) into the structured JSON the embedded agent consumes.
// The agent applies these field-by-field; it never sees HTML strings.

export function structurizeFixes(fixes) {
  const out = { title: null, description: null, og: null, schema: null, tldr: null };
  for (const f of fixes || []) {
    const v = String(f.value || "");
    switch (f.type) {
      case "title":
        out.title = v.trim();
        break;
      case "description":
        out.description = v.trim();
        break;
      case "tldr":
        out.tldr = v.replace(/^\s*TL;DR:?\s*/i, "").trim();
        break;
      case "og": {
        const og = {};
        const re = /<meta\s+property=["']og:([^"']+)["']\s+content=["']([^"']*)["']/gi;
        let m;
        while ((m = re.exec(v))) og[m[1]] = m[2];
        out.og = Object.keys(og).length ? og : null;
        break;
      }
      case "schema": {
        const inner = v.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
        const text = (inner ? inner[1] : v).trim();
        try {
          out.schema = JSON.parse(text);
        } catch {
          out.schema = text;
        }
        break;
      }
    }
  }
  return out;
}
