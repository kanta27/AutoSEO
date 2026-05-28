// SEO + GEO handoff synthesis — both use the same LLM loop shape: locate a
// file in the configured repo, read its current content, propose FULL
// replacement content addressing the finding. The system prompt differs by
// source agent. The available tools are the same file-find/read/submit ones
// the original SEO-Fix agent used.
//
// This session deliberately scopes the SEO path to missing-meta-description
// only. Other SEO findings fall through to "couldn't synthesize" with a
// reason — explicit gap, not silent drop.
import "server-only";

import { runAgent } from "../runner";
import { loadSkills } from "../skills";
import { getCompanyContextTool } from "../tools/common";
import {
  findFileInRepoTool,
  readFileInRepoTool,
  createSubmitTools,
  type SeoFixDeliverable,
} from "@/lib/agents/seo-fix/tools";
import type { Company, Proposal } from "@/lib/supabase/types";
import type { NewProposal } from "@/lib/proposals";

// Vendored marketing skills for the Coding agent's LLM synthesis paths. These
// give the agent frameworks for reasoning about what a good SEO/GEO fix is at
// the file level. See skills/README.md. Toggle off with SKILLS_ENABLED=false.
//
// Note: the deterministic blog-handoff path doesn't load skills — there's no
// LLM call to enrich.
const CODING_SKILLS = ["seo-audit", "ai-seo", "schema", "site-architecture"];

export type LlmHandoffOutcome =
  | { ok: true; proposal: NewProposal }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// SEO handoff — pattern-matched to ONE finding (the handed-off one). The
// agent receives that finding's context up-front and is forbidden from
// browsing the queue itself.
export async function synthesizeSeoHandoff(
  company: Company,
  handoff: Proposal,
  runId: string | undefined,
): Promise<LlmHandoffOutcome> {
  const issue = (handoff.payload as { issue?: SeoIssue }).issue;
  const solverType = issue?.solver?.type;

  if (solverType !== "description") {
    return {
      ok: false,
      reason:
        `SEO fix synthesis for solver_type="${solverType ?? "(none)"}" is not ` +
        `implemented yet — only "description" is supported in this version. ` +
        `Coming in a future session.`,
    };
  }

  const prompt = buildSeoSystemPrompt(handoff, issue);
  return runHandoffAgent(company, handoff, runId, prompt, "seo");
}

// ---------------------------------------------------------------------------
// GEO handoff — front-load the answer to the cited gap into the page that
// best matches. v1: targets the company root URL since we can't reliably
// map a query → specific page without more signal.
export async function synthesizeGeoHandoff(
  company: Company,
  handoff: Proposal,
  runId: string | undefined,
): Promise<LlmHandoffOutcome> {
  const gap = (handoff.payload as { gap?: GeoGap }).gap;
  if (!gap?.topic) {
    return { ok: false, reason: "GEO gap payload is missing a topic." };
  }
  const prompt = buildGeoSystemPrompt(handoff, gap);
  return runHandoffAgent(company, handoff, runId, prompt, "geo");
}

// ---------------------------------------------------------------------------
// Shared agent runner — the only difference between SEO and GEO at the
// machinery level is the system prompt and the source_agent label.
async function runHandoffAgent(
  company: Company,
  handoff: Proposal,
  runId: string | undefined,
  systemPrompt: string,
  sourceAgent: "seo" | "geo",
): Promise<LlmHandoffOutcome> {
  const { submitCodeChange, submitUnfixable, read } = createSubmitTools();

  // Skills appended AFTER the per-handoff operational prompt — the explicit
  // step order and hard rules above remain primary; skills add framework
  // context (what good schema looks like, AI-citability heuristics, etc.).
  const skillsBlock = loadSkills(CODING_SKILLS);
  const fullPrompt = skillsBlock ? `${systemPrompt}\n\n${skillsBlock}` : systemPrompt;

  const result = await runAgent({
    agentKey: "coding",
    company,
    runId,
    systemPrompt: fullPrompt,
    tools: [
      getCompanyContextTool,
      findFileInRepoTool,
      readFileInRepoTool,
      submitCodeChange,
      submitUnfixable,
    ],
    maxSteps: 8,
  });

  if (result.failureReason) {
    return { ok: false, reason: result.failureReason };
  }
  if (result.budgetExhausted) {
    return {
      ok: false,
      reason: `Step budget exhausted (${result.steps}) before submit.`,
    };
  }

  const delivered = read();
  if (!delivered) {
    return { ok: false, reason: "Agent loop ended without submitting." };
  }
  if (delivered.kind === "unfixable") {
    return {
      ok: false,
      reason: delivered.reason || "Agent declined to synthesize a fix.",
    };
  }
  return {
    ok: true,
    proposal: deliverableToProposal(delivered, sourceAgent, handoff.id),
  };
}

function deliverableToProposal(
  d: Extract<SeoFixDeliverable, { kind: "code_change" }>,
  sourceAgent: "seo" | "geo",
  sourceProposalId: string,
): NewProposal {
  return {
    agent_key: "coding",
    type: "code_change",
    title: d.suggested_pr_title || d.finding_title || "Proposed code change",
    summary:
      `${d.rationale}\n\n— Branch: ${d.suggested_branch} · ${d.files.length} file(s) changed` +
      (d.finding_title ? `\n— Fixes: ${d.finding_title}` : ""),
    payload: {
      source_agent: sourceAgent,
      source_proposal_id: sourceProposalId,
      rationale: d.rationale,
      files: d.files,
      suggested_branch: d.suggested_branch,
      suggested_pr_title: d.suggested_pr_title,
      suggested_pr_body: d.suggested_pr_body,
      finding_title: d.finding_title,
    },
  };
}

// ---------------------------------------------------------------------------
// Prompt builders. The handed-off finding is injected verbatim so the agent
// doesn't need to consult the queue itself — synthesis runs strictly per-row.

type SeoIssue = {
  id?: string;
  title?: string;
  category?: string;
  severity?: string;
  detail?: string;
  evidence?: string;
  solver?: { type?: string; current?: string; hint?: string };
};

function buildSeoSystemPrompt(handoff: Proposal, issue: SeoIssue | undefined): string {
  const findingTitle = issue?.title ?? handoff.title;
  const currentValue = issue?.solver?.current ?? "(none — meta description missing)";
  const hint = issue?.solver?.hint ?? "";
  return `You are the SEO-Fix path of the AutoSEO Coding Agent.

The human has APPROVED this SEO finding and asked you to produce a code-level
fix as a Pull Request. The PR will NEVER be merged automatically — a human
reviews the PR you propose.

The finding (handed off, do NOT browse for others):
- Title: ${findingTitle}
- Category: ${issue?.category ?? "on-page"}
- Severity: ${issue?.severity ?? "high"}
- Solver type: ${issue?.solver?.type ?? "description"}
- Current value: ${currentValue}
${hint ? `- Solver hint: ${hint}` : ""}

Work in this order:
1. Call get_company_context for the brand voice (so the new meta description
   sounds like the company).
2. Call find_file_in_repo. Try the most likely filename candidates first
   ("page.tsx", "index.html", "layout.tsx", "page.html"). Inspect the
   returned paths; pick the one most likely to be the home page.
3. Call read_file_in_repo for that path. If found=false, call
   submit_unfixable with reason "couldn't locate file in repo".
4. Construct the FULL replacement file content with the new meta description
   inserted as a SINGLE conservative edit:
     - In HTML: insert <meta name="description" content="..."> inside <head>
       if missing, or update the existing tag's content.
     - In Next.js TSX: add or update the metadata.description export.
   The new description must be 140-160 chars, include the company's primary
   keyword, and read naturally in the brand voice.
5. Call submit_code_change with the result. Branch name MUST start with
   "autoseo/" and MUST NOT be main/master/prod.

Hard rules:
- Do NOT browse other findings — you are scoped to the one above.
- Do NOT propose changes to more than one file.
- If you can't confidently fix it, call submit_unfixable with a clear reason.
- The repo content the connector writes IS the file's full new content —
  there is no diffing layer.`;
}

type GeoGap = {
  topic?: string;
  gap_type?: string;
  suggested_addition?: string;
};

function buildGeoSystemPrompt(handoff: Proposal, gap: GeoGap): string {
  return `You are the GEO-Fix path of the AutoSEO Coding Agent.

The human has APPROVED this GEO citable-gap finding and asked you to produce
a code-level fix as a Pull Request. The PR will NEVER be merged automatically.

The gap (handed off, do NOT browse for others):
- Topic: ${gap.topic ?? handoff.title}
- Gap type: ${gap.gap_type ?? "(unspecified)"}
- Suggested addition: ${gap.suggested_addition ?? "(none provided)"}

Goal: edit the most likely landing page to FRONT-LOAD a direct, citable
answer to the topic in the first 300 chars of visible content. AI search
engines like ChatGPT/Perplexity favour content that answers the question
explicitly near the top of the page.

Work in this order:
1. Call get_company_context for brand voice.
2. Call find_file_in_repo for the most likely page candidates
   ("page.tsx", "index.html", "page.html"). Pick the one that looks like
   the home page.
3. Call read_file_in_repo for that path. If found=false, call
   submit_unfixable with reason "couldn't locate page in repo".
4. Construct FULL replacement file content that inserts the suggested
   addition as ONE short paragraph (40-80 words) near the top of the
   visible body. Preserve all existing content. Do NOT rewrite the page.
5. Call submit_code_change. Branch MUST start with "autoseo/" and MUST NOT
   be main/master/prod.

Hard rules:
- One paragraph, near the top, that's it. Do not redesign the page.
- If the right insertion point is unclear, call submit_unfixable.
- One file per PR.`;
}
