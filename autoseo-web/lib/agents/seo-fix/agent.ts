// SEO-fix agent — picks ONE pending SEO finding for this company and proposes
// a code-level fix as a `code_change` proposal. Approval (in the human gate)
// opens a PR on the configured GitHub repo. The agent NEVER touches the repo.
//
// Loop shape (LLM-driven via tool calls):
//   1. get_company_context     — identity (so the agent writes in voice for copy)
//   2. get_seo_findings        — pick ONE actionable finding
//   3. find_file_in_repo       — locate the page file(s) to patch
//   4. read_file_in_repo       — pull the current content
//   5. submit_code_change      — TERMINAL, returns the deliverable
//      OR
//      submit_unfixable        — TERMINAL, agent gives up cleanly
//
// Scope for THIS session (v1): focused on missing meta descriptions. The
// shared skeleton makes adding the other fix types (missing H1, schema, etc)
// follow-up work — the system prompt scopes it, the tools are generic.
import "server-only";

import { runAgent } from "../runner";
import { getCompanyContextTool } from "../tools/common";
import {
  getSeoFindingsTool,
  findFileInRepoTool,
  readFileInRepoTool,
  createSubmitTools,
  type SeoFixDeliverable,
} from "./tools";
import type { Company } from "@/lib/supabase/types";
import type { NewProposal } from "@/lib/proposals";

const SYSTEM_PROMPT = `You are the SEO-Fix Agent for AutoSEO.

Your job: pick ONE pending SEO finding for this company and propose a CODE-LEVEL
fix as a Pull Request. The PR is NEVER merged automatically — a human reviews it.

Work in this order:
1. Call get_company_context for brand voice + identity (so any copy you write
   in meta tags / titles matches the brand).
2. Call get_seo_findings. Filter to findings whose solver_type is one of:
   "description" (missing or weak meta description). Prefer "critical" over
   "high" severity. If no such finding exists, pick the most actionable one
   you can with category "on-page". If nothing qualifies, call submit_unfixable
   with reason "no actionable findings".
3. Call find_file_in_repo with the most likely filename for the customer's site.
   Try the most generic candidates first ("page.tsx", "index.html", "layout.tsx",
   "page.html"). Inspect the returned paths; pick the one MOST LIKELY to be the
   home page or the page referenced in the finding.
4. Call read_file_in_repo for that path. If found=false, call submit_unfixable
   with reason "couldn't locate file in repo".
5. Construct the FULL replacement file content. Insert a single new tag or
   modify the existing one — DO NOT rewrite the whole page. Conservative edits
   only. For meta description:
     • In HTML: insert <meta name="description" content="..."> inside <head>.
     • In Next.js TSX: add or update the \`metadata.description\` export.
   The new meta description must be 140-160 chars, include the company's
   primary product/service keyword, and read naturally in the brand voice.
6. Call submit_code_change with:
     - finding_title:     the verbatim title of the picked finding
     - rationale:         2-3 sentences on what was missing and why this helps
     - files:             [{ path, content }] — FULL new content (not a diff)
     - suggested_branch:  "autoseo/fix-meta-description-<unix_ts>". MUST start
                          with "autoseo/" and MUST NOT be main/master/prod.
     - suggested_pr_title: imperative, e.g. "Add meta description to home page"
     - suggested_pr_body:  markdown — what changed, why, reviewer notes

Hard rules:
- Never propose changes to the same file twice in one call.
- Never propose pushing directly to main/master/prod. The branch name guard
  in submit_code_change will reject it.
- If you can't find the file or generate confident replacement content, use
  submit_unfixable. A pending note is better than a wrong PR.
- One finding per run. Resist the urge to fix everything.
- The repo content the connector writes IS the file's full new content —
  there is no diffing layer.`;

export type SeoFixAgentResult = {
  proposals: NewProposal[];
  failure: string | null;
};

export async function runSeoFixAgent(
  company: Company,
  runId: string | undefined,
): Promise<SeoFixAgentResult> {
  const { submitCodeChange, submitUnfixable, read } = createSubmitTools();

  const result = await runAgent({
    agentKey: "coding",
    company,
    runId,
    systemPrompt: SYSTEM_PROMPT,
    tools: [
      getCompanyContextTool,
      getSeoFindingsTool,
      findFileInRepoTool,
      readFileInRepoTool,
      submitCodeChange,
      submitUnfixable,
    ],
    maxSteps: 8,
  });

  if (result.failureReason) {
    return { proposals: [], failure: result.failureReason };
  }
  if (result.budgetExhausted) {
    return {
      proposals: [],
      failure: `Step budget exhausted (${result.steps}) before submit.`,
    };
  }

  const delivered = read();
  if (!delivered) {
    return {
      proposals: [],
      failure: "Agent loop ended without submitting.",
    };
  }

  return { proposals: [deliverableToProposal(delivered)], failure: null };
}

function deliverableToProposal(d: SeoFixDeliverable): NewProposal {
  if (d.kind === "unfixable") {
    // We still record the agent's reasoning so the user sees the gap in the
    // feed — surfaces under the coding agent group as a plain note with
    // type `code_change_skipped` (no GitHub call on approve; falls through
    // to the default state-flip branch).
    return {
      agent_key: "coding",
      type: "code_change_skipped",
      title: `Couldn't auto-fix: ${d.finding_title || "SEO finding"}`,
      summary: d.reason,
      payload: {
        source_agent: "seo",
        reason: d.reason,
        finding_title: d.finding_title,
      },
    };
  }

  // Code-change happy path. Payload shape matches CodeChangePayload in
  // lib/supabase/types.ts; the approval handler casts to that.
  return {
    agent_key: "coding",
    type: "code_change",
    title: d.suggested_pr_title || d.finding_title || "Proposed code change",
    summary:
      `${d.rationale}\n\n— Branch: ${d.suggested_branch} · ${d.files.length} file(s) changed` +
      (d.finding_title ? `\n— Fixes: ${d.finding_title}` : ""),
    payload: {
      source_agent: d.source_agent,
      rationale: d.rationale,
      files: d.files,
      suggested_branch: d.suggested_branch,
      suggested_pr_title: d.suggested_pr_title,
      suggested_pr_body: d.suggested_pr_body,
      finding_title: d.finding_title,
    },
  };
}
