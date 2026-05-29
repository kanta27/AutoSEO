// Blog Agent — first agent on the shared skeleton.
//
// Goal: produce ONE publish-ready article that targets a real keyword/topic gap
// for this company, written in its brand voice, structured for search ranking.
//
// Loop shape (the LLM drives this via tool calls; the system prompt below
// explains the contract). The order is signal-gathering FIRST, then topic
// selection, then drafting — so the chosen topic reflects current world
// context (news, competitor moves, trends) rather than just on-site signal.
//   1. get_company_context              — identity + brand voice
//   2. get_keyword_gaps                 — what should this article target?
//   3. get_news_for_topic               — recent news hooks (Tavily; optional)
//   4. get_competitor_signals           — what competitors just published
//   5. get_trending_topics_for_industry — broader category trend
//   6. (now pick the topic, weighing all of the above)
//   7. web_search                       — supporting facts for the chosen topic (optional)
//   8. seo_self_check                   — verify the deterministic checklist
//   9. (if failed) revise once
//  10. submit_article                   — terminal; returns the deliverable
import "server-only";

import { runAgent } from "../runner";
import { loadSkills } from "../skills";
import {
  getCompanyContextTool,
  getKeywordGapsTool,
  webSearchTool,
} from "../tools/common";
import {
  getNewsForTopicTool,
  getCompetitorSignalsTool,
  getTrendingTopicsForIndustryTool,
} from "./signal-tools";
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
1. Call get_company_context for identity + brand voice.
2. Call get_keyword_gaps for SEO-derived topics.
3. Call get_news_for_topic with the company's category or product as the query, to find recent
   newsworthy hooks. (If available=false, skip.)
4. Call get_competitor_signals to see what competitors have published lately — to either avoid
   duplication or to go DEEPER on a topic they covered shallowly. (If available=false, skip.)
5. Call get_trending_topics_for_industry for broader signal. (If available=false, skip.)
6. NOW pick the single best topic, weighing:
   - SEO opportunity (keyword gap with real volume)
   - Timeliness (a news hook makes the article feel fresh)
   - Differentiation (don't write what a competitor already published this week — go deeper or
     pick a different angle)
   - Fit with the company's product/audience (must be concretely writable)
   Be explicit in your reasoning about WHY you picked it (visible in your next tool call).
7. (Optional) Call web_search up to twice for current facts/stats to make
   the article citable. If web_search returns { available: false }, skip
   research and write from context — do not call it again.
   Then draft the article in the brand voice. Structure for SEO:
   - Title: 30–65 chars, includes the target keyword, compelling not clickbait.
   - Meta description: 140–160 chars, includes keyword, has a soft CTA.
   - Body markdown: starts with "# {H1 Title}" that includes the keyword.
     Includes the target keyword in the FIRST 100 WORDS. At least 3 "## " H2
     section headings. 800–1500 words. Concrete examples, no fluff.
   - Slug: kebab-case derived from the title.
   - Internal links: 2–4 suggested anchor → target_path pairs to other pages
     on the company's site that would be relevant. Use plausible paths
     (e.g. "/blog/related-topic"); the human will verify them at review.
8. Call seo_self_check with the full draft. If passed=false, REVISE the draft
   to fix every listed issue, then call seo_self_check ONCE more. If it still
   fails, submit anyway — the human will adjust.
9. Call submit_article with the final draft.

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
      getNewsForTopicTool,
      getCompetitorSignalsTool,
      getTrendingTopicsForIndustryTool,
      webSearchTool,
      seoSelfCheckTool,
      submitTool,
    ],
    maxSteps: 10,
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
