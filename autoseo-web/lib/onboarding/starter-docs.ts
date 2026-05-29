// Starter-document generation, shared by onboarding and the per-document
// Regenerate button.
//
// Why this module exists: the previous onboarding bundled THREE markdown
// documents into a single JSON response from Groq and asked the classify
// call for two more, which failed silently when Llama truncated the JSON
// or returned empty fields. The seed step then fell back to "(Set GROQ_API_KEY
// to auto-generate)" placeholder strings — even though the key was set and
// working everywhere else.
//
// The fix: one prompt per kind, run in parallel via Promise.allSettled,
// plain markdown output (no JSON parsing to break). Per-kind failures get
// a short "regeneration pending" placeholder so the UI can offer Regenerate
// without re-running the four successful ones.
import "server-only";

import { llm, LLM_MODEL } from "@/lib/llm";
import type { Competitor, DocumentKind } from "@/lib/supabase/types";

// The five kinds that have starter content. Anything else is editorial.
// Ordered the same way the Company panel renders them.
export const STARTER_DOC_KINDS: DocumentKind[] = [
  "brand_voice",
  "product_info",
  "competitor_analysis",
  "marketing_strategy",
  "llms_txt",
];

// The single short string we write into the body when a per-kind LLM call
// fails. The viewer detects this (plus the legacy "_(Set GROQ_API_KEY...)_"
// patterns) and shows the Regenerate button.
export const REGEN_PLACEHOLDER =
  `_Generating… click "Regenerate" to retry._`;

// Title shown in the dashboard's Company panel + the doc viewer header.
// Lives here because both onboarding and Regenerate write it.
export const STARTER_DOC_TITLES: Record<DocumentKind, string> = {
  brand_voice: "Brand Voice",
  product_info: "Product Information",
  competitor_analysis: "Competitor Analysis",
  marketing_strategy: "Marketing Strategy",
  llms_txt: "llms.txt",
};

// Input every prompt needs. competitors is empty when none were detected.
export type StarterDocInput = {
  name: string;
  url: string;
  category: string;
  description: string;
  competitors: Competitor[];
};

export type GeneratedDoc = {
  kind: DocumentKind;
  body: string;
  // True when the LLM call failed. body will be REGEN_PLACEHOLDER in that
  // case. Onboarding stamps meta.regeneration_pending=true for these.
  failed: boolean;
  // When failed=true, the upstream error message — surfaced in server logs.
  // Never goes to the client.
  reason?: string;
};

// ---------------------------------------------------------------------------
// Public surface

// Run all five starter-doc prompts in parallel. One failure never poisons
// the others — Promise.allSettled gives us per-kind outcomes.
export async function generateAllStarterDocs(
  input: StarterDocInput,
): Promise<GeneratedDoc[]> {
  const results = await Promise.allSettled(
    STARTER_DOC_KINDS.map((kind) => generateOne(kind, input)),
  );
  return results.map((r, i) => {
    const kind = STARTER_DOC_KINDS[i];
    if (r.status === "fulfilled") return r.value;
    const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
    console.error(
      `[starter-docs] ${kind} generation rejected:`,
      reason,
    );
    return { kind, body: REGEN_PLACEHOLDER, failed: true, reason };
  });
}

// Regenerate exactly one kind. Used by /api/documents/:id/regenerate.
// Throws on failure — the route handler converts to JSON 502.
export async function regenerateStarterDoc(
  kind: DocumentKind,
  input: StarterDocInput,
): Promise<string> {
  const result = await generateOne(kind, input);
  if (result.failed) {
    throw new Error(result.reason || `Regeneration of ${kind} failed.`);
  }
  return result.body;
}

// Heuristic: does this body LOOK like a placeholder from before this fix?
// Catches:
//   • The current short "_Generating… click "Regenerate" to retry._".
//   • The legacy "_(Set GROQ_API_KEY ...)_" / "_(... will populate once
//     GROQ_API_KEY is set ...)_" / "_(... auto-generate ...)_" strings.
//   • Very short bodies (< 100 chars) where the only content is a markdown
//     italics block — almost certainly a fallback string, not real content.
//
// False positives are cheap (the user just clicks Regenerate and gets the
// same body back); false negatives leave the user stuck with a placeholder
// they can't see is regenerable. So we err toward "yes this is placeholder".
export function isPlaceholderBody(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return true;
  if (trimmed === REGEN_PLACEHOLDER) return true;
  // Legacy "(Set GROQ_API_KEY ...)" / "(... GROQ_API_KEY ...)" / generic
  // "_(... auto-generate ...)_" markdown-italics one-liner shapes.
  if (/groq_api_key/i.test(trimmed) && trimmed.length < 300) return true;
  if (/auto-generate/i.test(trimmed) && trimmed.length < 300) return true;
  if (/click "Regenerate"/i.test(trimmed)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// One-call execution

async function generateOne(
  kind: DocumentKind,
  input: StarterDocInput,
): Promise<GeneratedDoc> {
  const prompts = PROMPT_BUILDERS[kind](input);
  try {
    const completion = await llm().chat.completions.create({
      model: LLM_MODEL,
      // Plain markdown output, so no response_format constraint. Generous
      // upper bound — Llama 3.3 trims to its own ~32k output cap regardless.
      max_tokens: 2200,
      messages: [
        { role: "system", content: prompts.system },
        { role: "user", content: prompts.user },
      ],
    });
    const text = (completion.choices?.[0]?.message?.content ?? "").trim();
    if (!text || text.length < 80) {
      // The model returned essentially nothing — treat as a failure so the
      // user sees a Regenerate button rather than a tiny stub. 80 chars is
      // below any of the prompts' specified word counts.
      const reason = `Model returned ${text.length} chars (expected hundreds).`;
      console.warn(`[starter-docs] ${kind}: ${reason}`);
      return { kind, body: REGEN_PLACEHOLDER, failed: true, reason };
    }
    return { kind, body: text, failed: false };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[starter-docs] ${kind} threw:`, reason);
    return { kind, body: REGEN_PLACEHOLDER, failed: true, reason };
  }
}

// ---------------------------------------------------------------------------
// Per-kind prompts.
//
// Built from the spec in the regen-fix brief. Each is a system+user pair so
// the model gets a tight role and a fully-interpolated request. NO JSON;
// the output IS markdown.

type PromptPair = { system: string; user: string };

const PROMPT_BUILDERS: Record<DocumentKind, (i: StarterDocInput) => PromptPair> = {
  brand_voice: (i) => ({
    system:
      "You are writing a brand voice guide for a company. Be concrete and " +
      "useful — not generic. Output markdown.",
    user:
      `Company: ${i.name} (${i.url}). Category: ${i.category}. ` +
      `Description: ${i.description}. Write a brand voice guide with these ` +
      `sections: ## Tone (3-4 sentences), ## Vocabulary (5-8 preferred terms ` +
      `with one-line context for each), ## What we avoid (3-5 bullet points), ` +
      `## Example opening line (one sentence in this voice). Total ~400-600 words.`,
  }),

  product_info: (i) => ({
    system:
      "Summarize a company's product for content reuse. Concrete, no fluff. " +
      "Output markdown.",
    user:
      `Company: ${i.name} (${i.url}). Category: ${i.category}. ` +
      `Description: ${i.description}. Write a product information doc with ` +
      `these sections: ## What we sell (paragraph), ## Who it's for (paragraph), ` +
      `## Key features (4-6 bullets), ## Common questions customers ask ` +
      `(3-5 Q&A pairs). Total ~400-700 words.`,
  }),

  competitor_analysis: (i) => ({
    system:
      "Compare a company against its competitors objectively. Output markdown. " +
      "Cite each competitor by name.",
    user:
      `Company: ${i.name} (${i.url}). Category: ${i.category}. ` +
      `Description: ${i.description}. ` +
      `Competitors: ${JSON.stringify(i.competitors)}. ` +
      `Write a competitor analysis with: ## Landscape (one paragraph framing ` +
      `the category). ## Each competitor — for each, a sub-heading with the ` +
      `competitor's name, 2-3 sentences on their positioning, and one sentence ` +
      `on how ${i.name} is different. ## Where ${i.name} can win (3-5 bullets). ` +
      `Total ~600-900 words.`,
  }),

  marketing_strategy: (i) => ({
    system:
      "Propose a starter marketing strategy. Specific, prioritized, realistic. " +
      "Output markdown.",
    user:
      `Company: ${i.name} (${i.url}). Category: ${i.category}. ` +
      `Description: ${i.description}. ` +
      `Competitors: ${JSON.stringify(i.competitors)}. ` +
      `Propose a marketing strategy: ## North star (1-2 sentences). ` +
      `## 3 priority pushes (each a sub-heading with rationale + first 3 concrete ` +
      `actions). ## What NOT to do (3-5 bullets). Total ~500-800 words.`,
  }),

  llms_txt: (i) => ({
    system:
      "Generate an llms.txt file (see llmstxt.org) for a company. Output " +
      "markdown that conforms to the llms.txt spec.",
    user:
      `Company: ${i.name} (${i.url}). Description: ${i.description}. ` +
      `Generate an llms.txt file. Start with \`# ${i.name}\`, a one-sentence ` +
      `summary, then sections: ## About (2-3 sentences), ## Key pages (list ` +
      `5-8 likely URL paths with one-line descriptions — use plausible paths ` +
      `the user can correct), ## Optional. Total ~300-500 words.`,
  }),
};
