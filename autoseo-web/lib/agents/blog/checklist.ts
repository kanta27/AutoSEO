// Deterministic SEO checklist for a draft article. The blog agent calls this
// via the `seo_self_check` tool; if it fails the agent gets one revision pass
// before submitting anyway (we'd rather ship a flawed-but-real draft to the
// human reviewer than spin the loop forever).
//
// Each check returns a human-readable issue string the LLM can read. Keep
// these tight so a revision can target them.

export type SeoCheckInput = {
  title: string;
  meta_description: string;
  body_md: string;
  target_keyword: string;
};

export type SeoCheckResult = {
  passed: boolean;
  issues: string[];
  metrics: {
    title_len: number;
    meta_len: number;
    word_count: number;
    h2_count: number;
    keyword_in_title: boolean;
    keyword_in_h1: boolean;
    keyword_in_first_100w: boolean;
  };
};

const MIN_WORDS = 800;
const MAX_WORDS = 1500;
const MIN_TITLE = 30;
const MAX_TITLE = 65;
const MIN_META = 140;
const MAX_META = 160;
const MIN_H2 = 3;

export function checkArticle(input: SeoCheckInput): SeoCheckResult {
  const issues: string[] = [];
  const kw = input.target_keyword.trim().toLowerCase();

  const titleLen = input.title.length;
  if (titleLen < MIN_TITLE || titleLen > MAX_TITLE) {
    issues.push(
      `Title length ${titleLen} chars — aim for ${MIN_TITLE}–${MAX_TITLE}.`,
    );
  }
  const keywordInTitle = !!kw && input.title.toLowerCase().includes(kw);
  if (!keywordInTitle) {
    issues.push(`Title must include the target keyword "${input.target_keyword}".`);
  }

  const metaLen = input.meta_description.length;
  if (metaLen < MIN_META || metaLen > MAX_META) {
    issues.push(
      `Meta description length ${metaLen} chars — aim for ${MIN_META}–${MAX_META}.`,
    );
  }

  // Markdown parsing — we only care about the H1 (one #) and H2s (##), and
  // word count of the plaintext body.
  const lines = input.body_md.split("\n");
  const h1Lines = lines.filter((l) => /^#\s+/.test(l));
  const h2Count = lines.filter((l) => /^##\s+/.test(l)).length;
  if (h2Count < MIN_H2) {
    issues.push(
      `Only ${h2Count} H2 section${h2Count === 1 ? "" : "s"} — aim for at least ${MIN_H2}.`,
    );
  }

  const h1Text = h1Lines[0]?.replace(/^#\s+/, "") ?? "";
  const keywordInH1 = !!kw && h1Text.toLowerCase().includes(kw);
  if (h1Lines.length === 0) {
    issues.push("Body must start with an H1 (# Title).");
  } else if (!keywordInH1) {
    issues.push(`H1 must include the target keyword "${input.target_keyword}".`);
  }

  // First-100-words check — strip markdown markers, take first 100 words.
  const plain = input.body_md
    .replace(/^#+\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\[(.+?)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const words = plain.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const first100 = words.slice(0, 100).join(" ").toLowerCase();
  const keywordInFirst100 = !!kw && first100.includes(kw);
  if (!keywordInFirst100) {
    issues.push(
      `Target keyword "${input.target_keyword}" must appear in the first 100 words.`,
    );
  }

  if (wordCount < MIN_WORDS || wordCount > MAX_WORDS) {
    issues.push(
      `Word count ${wordCount} — aim for ${MIN_WORDS}–${MAX_WORDS}.`,
    );
  }

  return {
    passed: issues.length === 0,
    issues,
    metrics: {
      title_len: titleLen,
      meta_len: metaLen,
      word_count: wordCount,
      h2_count: h2Count,
      keyword_in_title: keywordInTitle,
      keyword_in_h1: keywordInH1,
      keyword_in_first_100w: keywordInFirst100,
    },
  };
}
