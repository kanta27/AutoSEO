// Blog-agent-specific tools. `seo_self_check` runs the deterministic checklist
// the LLM can call any number of times during the loop; `submit_article` is
// the terminal tool — calling it ends the loop and the runner returns the
// draft as the agent's deliverable.
import "server-only";

import type { AgentTool } from "../tools";
import { checkArticle, type SeoCheckResult } from "./checklist";

export type BlogDraftPayload = {
  title: string;
  slug: string;
  meta_description: string;
  body_md: string;
  target_keyword: string;
  internal_links: Array<{ anchor: string; target_path: string; reason?: string }>;
  // Filled in by `seo_self_check` and stamped onto the payload at submission
  // so the reviewer can see exactly what the agent verified.
  self_check?: SeoCheckResult;
};

export const seoSelfCheckTool: AgentTool = {
  name: "seo_self_check",
  description:
    "Run the deterministic SEO checklist against a draft. Returns { passed, " +
    "issues[], metrics }. Use this before submitting; if passed is false, revise " +
    "the draft to fix the listed issues and call again (you have ONE revision " +
    "round before submitting anyway).",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      meta_description: { type: "string" },
      body_md: { type: "string" },
      target_keyword: { type: "string" },
    },
    required: ["title", "meta_description", "body_md", "target_keyword"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const result = checkArticle({
      title: String(args.title ?? ""),
      meta_description: String(args.meta_description ?? ""),
      body_md: String(args.body_md ?? ""),
      target_keyword: String(args.target_keyword ?? ""),
    });
    return {
      ok: true,
      data: result,
      log_summary: result.passed
        ? "self-check passed"
        : `self-check failed: ${result.issues.length} issue(s)`,
    };
  },
};

// In-memory hand-off slot: the terminal `submit_article` tool stuffs the draft
// here, the agent function reads it off after runAgent returns. Per-call so
// the runner can be invoked concurrently for different companies without
// clobbering.
export function createSubmitArticleTool(): {
  tool: AgentTool;
  read: () => BlogDraftPayload | null;
} {
  let submitted: BlogDraftPayload | null = null;
  const tool: AgentTool = {
    name: "submit_article",
    description:
      "FINAL STEP. Submit the completed article. Calling this ends the agent " +
      "loop. Provide every field — they all end up on the human-review proposal.",
    terminal: true,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Article title, 30–65 chars." },
        slug: {
          type: "string",
          description:
            "URL slug — kebab-case, derived from the title. Lowercase, no punctuation.",
        },
        meta_description: {
          type: "string",
          description: "Meta description, 140–160 chars.",
        },
        body_md: {
          type: "string",
          description:
            "Article body in markdown. Starts with `# H1 Title`. Use ## for sections (>=3). 800–1500 words.",
        },
        target_keyword: {
          type: "string",
          description: "The primary keyword/phrase this article targets.",
        },
        internal_links: {
          type: "array",
          description: "Suggested internal links to other pages on the site.",
          items: {
            type: "object",
            properties: {
              anchor: { type: "string" },
              target_path: { type: "string" },
              reason: { type: "string" },
            },
            required: ["anchor", "target_path"],
            additionalProperties: false,
          },
        },
      },
      required: [
        "title",
        "slug",
        "meta_description",
        "body_md",
        "target_keyword",
      ],
      additionalProperties: false,
    },
    execute: async (args) => {
      submitted = {
        title: String(args.title),
        slug: String(args.slug),
        meta_description: String(args.meta_description),
        body_md: String(args.body_md),
        target_keyword: String(args.target_keyword),
        internal_links: Array.isArray(args.internal_links)
          ? (args.internal_links as BlogDraftPayload["internal_links"])
          : [],
      };
      // Re-run the checklist server-side so the stamped self_check can't be
      // gamed by the LLM lying about a previous self_check result.
      submitted.self_check = checkArticle({
        title: submitted.title,
        meta_description: submitted.meta_description,
        body_md: submitted.body_md,
        target_keyword: submitted.target_keyword,
      });
      return {
        ok: true,
        data: { received: true, self_check_passed: submitted.self_check.passed },
        log_summary: `submitted draft "${submitted.title}"`,
      };
    },
  };
  return { tool, read: () => submitted };
}
