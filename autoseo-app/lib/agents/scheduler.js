// Cron-based scheduler for agents. Reads enabled agents from storage, schedules
// each by its cron expression, and dispatches to the right runner. New agents
// added at runtime need a server restart to register — acceptable for Phase 1.
//
// Disable via AUTOSEO_DISABLE_AGENT_SCHEDULER=1 (useful for one-off CLI runs).

import cron from "node-cron";
import { listAgents, getAgent } from "../storage/agents.js";
import { runCompetitorAgent } from "./competitor/agent.js";
import { runSeoAgent } from "./seo/agent.js";
import { runContentAgent } from "./content/agent.js";
import { getNotifier } from "../notify/index.js";

const PUBLIC_ENDPOINT =
  process.env.AUTOSEO_PUBLIC_ENDPOINT || `http://localhost:${process.env.PORT || 3000}`;

const RUNNERS = {
  competitor: runCompetitorAgent,
  seo: runSeoAgent,
  content: runContentAgent,
};

const scheduled = new Map(); // agentId -> cron task

async function runAndNotify(agent) {
  console.log(`[scheduler] running ${agent.name} (${agent.type})`);
  const runner = RUNNERS[agent.type];
  if (!runner) {
    console.warn(`[scheduler] no runner for type ${agent.type}`);
    return;
  }
  try {
    const results = await runner({ agentId: agent.id });
    const proposals = results.flatMap((r) => r.proposals || []);
    if (proposals.length && process.env.AGENT_DRY_RUN !== "1") {
      await getNotifier().sendDigest({
        summary: `${agent.name}: ${proposals.length} new proposal${proposals.length === 1 ? "" : "s"}`,
        proposals,
        dashboardUrl: `${PUBLIC_ENDPOINT}/admin/`,
      });
    } else if (process.env.AGENT_DRY_RUN === "1") {
      console.log(`[scheduler] dry-run: skipping notification for ${proposals.length} proposal(s)`);
    }
    return results;
  } catch (err) {
    console.error(`[scheduler] ${agent.name} failed: ${err.message}`);
    throw err;
  }
}

export async function startAgentScheduler() {
  if (process.env.AUTOSEO_DISABLE_AGENT_SCHEDULER === "1") return;
  const agents = await listAgents();
  for (const a of agents) {
    if (!a.enabled || !a.schedule) continue;
    if (!cron.validate(a.schedule)) {
      console.warn(`[scheduler] invalid cron for ${a.name}: "${a.schedule}"`);
      continue;
    }
    const job = cron.schedule(a.schedule, () => runAndNotify(a));
    scheduled.set(a.id, job);
    console.log(`[scheduler] scheduled ${a.name} (${a.schedule})`);
  }
}

/** Manually trigger one agent right now (CLI + admin "Run now" button). */
export async function triggerAgent(agentId) {
  const a = await getAgent(agentId);
  if (!a) throw new Error("Agent not found: " + agentId);
  return runAndNotify(a);
}
