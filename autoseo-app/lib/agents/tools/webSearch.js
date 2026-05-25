// Anthropic web search is a SERVER-SIDE tool — Anthropic executes it inside
// the API call and the model sees the results transparently. We just declare
// it in the tool list (no .execute). Requires an account tier with web search
// enabled. Disable via AUTOSEO_DISABLE_WEB_SEARCH=1 if you hit access errors.

export const webSearch = {
  name: "web_search",
  definition: {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 5,
  },
};

export function webSearchAvailable() {
  return process.env.AUTOSEO_DISABLE_WEB_SEARCH !== "1";
}
