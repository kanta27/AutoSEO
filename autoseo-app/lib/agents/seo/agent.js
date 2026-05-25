// SEO agent — STUB for Phase 2.
// Will analyze GSC + PageSpeed signals and emit fix proposals. Content fixes
// will write to the CMS; code fixes will open a GitHub PR.

export const seoAgent = {
  type: "seo",
  name: "SEO Watchdog",
  systemPrompt: "(stub — Phase 2)",
};

export async function runSeoAgent() {
  throw new Error("SEO agent: not implemented in Phase 1.");
}
