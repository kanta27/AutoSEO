// Registry of "runners" — the actual work behind each live agent.
//
// Multiple agent_keys can share one runner because the engine call is shared.
// Example: the Node audit produces proposals for BOTH the seo and geo agents
// in a single fetch + parse. If we naively looped over agents, seo and geo
// would each re-run the same audit and create duplicate proposals.
//
// Pattern:
//   1. RUNNERS holds the actual async functions, keyed by an opaque runner id.
//   2. RUNNER_BY_AGENT maps each live agent_key to its runner id.
//   3. The scheduler groups due agents by runner id, fires each runner once,
//      and attributes the resulting proposals back per agent_key.
//
// Runners receive a `runIds` map (agent_key → agent_runs.id). LLM-driven
// agents use it to write per-step trace rows into agent_logs; non-LLM
// runners (the Node audit HTTP call) ignore it.
import "server-only";

import { runNodeAudit } from "@/lib/engines/node-audit";
import { proposalsFromAudit, type NewProposal } from "@/lib/proposals";
import { runBlogAgent } from "@/lib/agents/blog/agent";
import { runCodingAgent } from "@/lib/agents/coding/agent";
import type { Company } from "@/lib/supabase/types";

export type RunnerCompany = Pick<Company, "id" | "url" | "name"> & {
  // The runner only needs identity + the URL/name. We pass the full Company
  // shape (cast at the call site) to LLM-driven agents that need profile/
  // documents context.
  description?: Company["description"];
  profile?: Company["profile"];
  created_at?: Company["created_at"];
};

export type RunnerResult = {
  // Proposals the SCHEDULER should insert. The Coding runner inserts its
  // own (because each row needs an id back to link the source handoff), so
  // it returns proposals: [] and reports the count via inlineInsertedCount.
  proposals: NewProposal[];
  // Optional structured failure info — only surfaced when the runner couldn't
  // produce proposals but didn't throw (e.g. the LLM ran out of step budget).
  // The scheduler will fold this into the summary's `failures` array.
  failure?: string;
  // When the runner inserted its own rows (Coding handoff path), this is the
  // count to attribute to agent_runs.proposals_created. The scheduler ADDS
  // this to whatever it inserted itself, so a runner can do both.
  inlineInsertedCount?: number;
};

export type Runner = (
  company: RunnerCompany,
  runIds: Record<string, string>,
) => Promise<RunnerResult>;

export type RunnerId = "node-audit" | "blog-agent" | "coding-handoff-agent";

export const RUNNERS: Record<RunnerId, Runner> = {
  "node-audit": async (company) => {
    const report = await runNodeAudit(company.url, { withFixes: true });
    return { proposals: proposalsFromAudit(report) };
  },
  "blog-agent": async (company, runIds) => {
    const result = await runBlogAgent(company as Company, runIds["blog"]);
    return { proposals: result.proposals, failure: result.failure ?? undefined };
  },
  "coding-handoff-agent": async (company, runIds) => {
    // Processes the handed-off queue from blog/SEO/GEO approvals and
    // synthesizes code_change proposals. Inserts inline because each row
    // needs its id linked back to the source handoff (see agent.ts).
    const result = await runCodingAgent(company as Company, runIds["coding"]);
    return {
      proposals: [], // Always empty — runner inserted its own.
      failure: result.failure ?? undefined,
      inlineInsertedCount: result.synthesized,
    };
  },
};

// Agent → runner. Live agents not in this map are "live in catalog but no
// runner yet" — the scheduler reports them as skipped, never as failures.
export const RUNNER_BY_AGENT: Record<string, RunnerId> = {
  seo: "node-audit",
  geo: "node-audit",
  blog: "blog-agent",
  coding: "coding-handoff-agent",
};
