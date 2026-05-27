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
import "server-only";

import { runNodeAudit } from "@/lib/engines/node-audit";
import { proposalsFromAudit, type NewProposal } from "@/lib/proposals";

export type RunnerCompany = { id: string; url: string; name: string };

export type RunnerResult = {
  // Flat list — each proposal carries its own agent_key already.
  proposals: NewProposal[];
};

export type Runner = (company: RunnerCompany) => Promise<RunnerResult>;

export type RunnerId = "node-audit";

export const RUNNERS: Record<RunnerId, Runner> = {
  "node-audit": async (company) => {
    const report = await runNodeAudit(company.url, { withFixes: true });
    return { proposals: proposalsFromAudit(report) };
  },
};

// Agent → runner. Live agents not in this map are "live in catalog but no
// runner yet" — the scheduler reports them as skipped, never as failures.
export const RUNNER_BY_AGENT: Record<string, RunnerId> = {
  seo: "node-audit",
  geo: "node-audit",
  // coding: pending — auto-fix path is a future session
};
