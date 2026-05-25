// Content agent — STUB for Phase 2.
// Will generate blog drafts → proposal → on approval, publish to Shopify Admin
// API / CMS and trigger a Next.js rebuild.

export const contentAgent = {
  type: "content",
  name: "Content Writer",
  systemPrompt: "(stub — Phase 2)",
};

export async function runContentAgent() {
  throw new Error("Content agent: not implemented in Phase 1.");
}
