// Blog Agent — first agent on the shared skeleton.
//
// Goal: produce ONE publish-ready article that targets a real keyword/topic gap
// for this company, written in its brand voice, structured for search ranking.
//
// Loop shape (the LLM drives this via tool calls; the system prompt below
// explains the contract):
//   1. get_company_context  — identity + brand voice
//   2. get_keyword_gaps     — what should this article target?
//   3. web_search           — facts/freshness for the chosen topic (optional)
//   4. draft mentally       — no tool; just the LLM thinking
//   5. seo_self_check       — verify the deterministic checklist
//   6. (if failed) revise once
//   7. submit_article       — terminal; returns the deliverable
import "server-only";

import { runAgent } from "../runner";
import { loadSkills } from "../skills";
import {
  getCompanyContextTool,
  getKeywordGapsTool,
  webSearchTool,
} from "../tools/common";
import {
  seoSelfCheckTool,
  createSubmitArticleTool,
  type BlogDraftPayload,
} from "./tools";
import type { Company } from "@/lib/supabase/types";
import type { NewProposal } from "@/lib/proposals";

// Vendored marketing skills (frameworks, not rules) appended to the system
// prompt. See skills/README.md for the rationale. Toggle off with
// SKILLS_ENABLED=false in .env.local.
const BLOG_SKILLS = ["copywriting", "content-strategy", "seo-audit", "ai-seo"];

const SYSTEM_PROMPT = `You are the Blog Agent for AutoSEO, an autonomous SEO platform.
Your job: draft ONE publish-ready article that helps this company rank for a
real keyword/topic gap.

Work in this order:
1. Call get_company_context to learn the brand voice, product, and tone.
2. Call get_keyword_gaps. If gaps are returned, pick the single best one
   based on: how concretely you can write about it given the company's
   product/audience, and traffic potential. If none are returned, propose
   a strong keyword/topic from the company's description and product info.
3. (Optional) Call web_search up to twice for current facts/stats to make
   the article citable. If web_search returns { available: false }, skip
   research and write from context — do not call it again.
4. Draft the article in the brand voice. Structure for SEO:
   - Title: 30–65 chars, includes the target keyword, compelling not clickbait.
   - Meta description: 140–160 chars, includes keyword, has a soft CTA.
   - Body markdown: starts with "# {H1 Title}" that includes the keyword.
     Includes the target keyword in the FIRST 100 WORDS. At least 3 "## " H2
     section headings. 800–1500 words. Concrete examples, no fluff.
   - Slug: kebab-case derived from the title.
   - Internal links: 2–4 suggested anchor → target_path pairs to other pages
     on the company's site that would be relevant. Use plausible paths
     (e.g. "/blog/related-topic"); the human will verify them at review.
5. Call seo_self_check with the full draft. If passed=false, REVISE the draft
   to fix every listed issue, then call seo_self_check ONCE more. If it still
   fails, submit anyway — the human will adjust.
6. Call submit_article with the final draft.

Hard rules:
- Never invent product features, prices, customer names, or statistics. If
  you don't know, write generically or omit.
- Brand voice is mandatory — match it explicitly (vocabulary, sentence shape).
- One topic per article. Resist the urge to cover everything.
- The body is in markdown, not HTML.
- You have a step budget. Be efficient.`;

export type BlogAgentResult = {
  // The shaped NewProposal[] to insert into the proposals table. Always
  // length 0 or 1 — the agent produces exactly one article per run, or
  // nothing if the LLM ran out of budget without submitting.
  proposals: NewProposal[];
  // Diagnostics surfaced to the scheduler summary on failure.
  failure: string | null;
};

export async function runBlogAgent(
  company: Company,
  runId: string | undefined,
): Promise<BlogAgentResult> {
  const { tool: submitTool, read: readSubmitted } = createSubmitArticleTool();

  // Skill content is appended AFTER the existing system prompt so the
  // operational instructions (brand voice, structure rules, step order)
  // remain primary. The skill block is wrapped in "## Reference frameworks"
  // — it informs reasoning but doesn't override the explicit rules above.
  const skillsBlock = loadSkills(BLOG_SKILLS);
  const systemPrompt = skillsBlock
    ? `${SYSTEM_PROMPT}\n\n${skillsBlock}`
    : SYSTEM_PROMPT;

  const result = await runAgent({
    agentKey: "blog",
    company,
    runId,
    systemPrompt,
    tools: [
      getCompanyContextTool,
      getKeywordGapsTool,
      webSearchTool,
      seoSelfCheckTool,
      submitTool,
    ],
    maxSteps: 6,
  });

  if (result.failureReason) {
    return { proposals: [], failure: result.failureReason };
  }
  if (result.budgetExhausted) {
    return {
      proposals: [],
      failure: `Step budget exhausted (${result.steps}) before submit_article.`,
    };
  }

  const draft = readSubmitted();
  if (!draft) {
    return {
      proposals: [],
      failure: "Agent loop ended without submitting an article.",
    };
  }

  return {
    proposals: [draftToProposal(draft)],
    failure: null,
  };
}

function draftToProposal(draft: BlogDraftPayload): NewProposal {
  const checkSummary = draft.self_check
    ? draft.self_check.passed
      ? `${draft.self_check.metrics.word_count} words · self-check passed`
      : `${draft.self_check.metrics.word_count} words · self-check FAILED: ${draft.self_check.issues.length} issue(s)`
    : `${draft.body_md.length}-char draft`;

  return {
    agent_key: "blog",
    type: "blog_post",
    title: draft.title,
    summary: `${draft.meta_description}\n\n— ${checkSummary} · target: "${draft.target_keyword}"`,
    payload: { ...draft },
  };
}
