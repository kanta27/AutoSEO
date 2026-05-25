// Solver swarm (spec §3.2) — turns findings into copy-paste-ready fixes.
// Uses Claude when ANTHROPIC_API_KEY is set (S1 Meta Rewriter, S2 Schema Injector,
// S7 GEO Optimizer); otherwise falls back to deterministic, rule-based suggestions
// so the app stays fully useful offline.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.AUTOSEO_MODEL || "claude-sonnet-4-6";

const SYSTEM = `You are the solver agent for AutoSEO, an autonomous SEO + GEO platform.
You receive a web page's context and a list of fixes to generate. For each requested
fix, produce production-ready output a developer can paste straight into HTML.

Rules:
- Titles: 50-60 chars, lead with the primary keyword, compelling not clickbait.
- Meta descriptions: 140-160 chars, include the keyword and a clear value prop + soft CTA.
- Schema: valid schema.org JSON-LD only (no comments), choose the @type that fits the page.
- TL;DR: 1-2 sentences, ~30-45 words, a direct self-contained answer an AI engine could quote verbatim.
- Open Graph: og:title, og:description, og:image tags as raw <meta> lines.
Base everything on the ACTUAL page content provided. Never invent facts, prices, or stats.`;

const TOOL = {
  name: "emit_fixes",
  description: "Return the generated fixes.",
  input_schema: {
    type: "object",
    properties: {
      fixes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["title", "description", "schema", "tldr", "og"] },
            value: { type: "string", description: "The ready-to-use output (HTML or text)." },
            rationale: { type: "string", description: "One short sentence on why this is better." },
          },
          required: ["type", "value"],
        },
      },
    },
    required: ["fixes"],
  },
};

function buildContext(page, parsed) {
  return {
    url: page.finalUrl,
    title: parsed.title,
    description: parsed.description,
    h1: parsed.h1,
    excerpt: parsed.text.slice(0, 1800),
  };
}

// Deterministic fallbacks when there's no API key.
function ruleBasedFix(req, ctx) {
  switch (req.type) {
    case "title":
      return { type: "title", value: (ctx.h1 || ctx.title || "Untitled").slice(0, 60),
        rationale: "Derived from the page H1; trim/keyword-load by hand." };
    case "description":
      return { type: "description", value: (ctx.excerpt || "").replace(/\s+/g, " ").slice(0, 155),
        rationale: "First sentences of body copy; rewrite with your keyword + CTA." };
    case "schema":
      return { type: "schema",
        value: `<script type="application/ld+json">\n${JSON.stringify(
          { "@context": "https://schema.org", "@type": "WebPage", name: ctx.title || ctx.h1, url: ctx.url },
          null, 2)}\n</script>`,
        rationale: "Minimal WebPage schema — expand to Article/FAQPage/Product as fits." };
    case "tldr":
      return { type: "tldr", value: "TL;DR: " + (ctx.excerpt || "").replace(/\s+/g, " ").slice(0, 180),
        rationale: "Stub from existing copy; tighten to one quotable answer." };
    case "og":
      return { type: "og",
        value: `<meta property="og:title" content="${ctx.title || ""}" />\n<meta property="og:description" content="${(ctx.description || "").slice(0,160)}" />\n<meta property="og:image" content="${ctx.url}/og-image.png" />`,
        rationale: "Template OG tags; supply a real 1200x630 image." };
    default:
      return null;
  }
}

export async function solve(issues, page, parsed) {
  // Collect unique fix requests attached to issues.
  const requests = [];
  const seen = new Set();
  for (const i of issues) {
    if (i.solver && !seen.has(i.solver.type)) {
      seen.add(i.solver.type);
      requests.push({ ...i.solver, findingId: i.id });
    }
  }
  if (requests.length === 0) return { engine: "none", fixes: [] };

  const ctx = buildContext(page, parsed);

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      engine: "rule-based",
      note: "Set ANTHROPIC_API_KEY for AI-written fixes. These are deterministic stubs.",
      fixes: requests.map((r) => ruleBasedFix(r, ctx)).filter(Boolean),
    };
  }

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "emit_fixes" },
      messages: [
        {
          role: "user",
          content:
            `Page context:\n${JSON.stringify(ctx, null, 2)}\n\n` +
            `Generate these fixes: ${requests.map((r) => r.type + (r.hint ? `(${r.hint})` : "")).join(", ")}.`,
        },
      ],
    });
    const block = msg.content.find((b) => b.type === "tool_use");
    const fixes = block?.input?.fixes || [];
    return { engine: "claude", model: MODEL, fixes };
  } catch (err) {
    return {
      engine: "rule-based",
      note: `Claude call failed (${err.message}); showing deterministic fallbacks.`,
      fixes: requests.map((r) => ruleBasedFix(r, ctx)).filter(Boolean),
    };
  }
}
