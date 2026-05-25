// Competitor Intelligence Agent — Phase 1, fully implemented.
//
// For each enabled competitor_target: crawl pages, persist snapshots, then ask
// Claude (with crawl / web_search / get_last_snapshot tools) to identify what's
// genuinely new and emit one digest proposal per target. No write tools — the
// agent strictly reports.

import { runAgent } from "../runner.js";
import { createRun, updateRun } from "../../storage/runs.js";
import { appendLog } from "../../storage/logs.js";
import { listTargets } from "../../storage/targets.js";
import { saveSnapshot } from "../../storage/snapshots.js";
import { crawlCompetitor } from "../tools/crawl.js";
import { webSearch, webSearchAvailable } from "../tools/webSearch.js";
import { getLastSnapshotTool } from "../tools/snapshots.js";

const SYSTEM = `You are the Competitor Intelligence Agent for an autonomous marketing system.

Your job per target: detect what is genuinely NEW since the last snapshot and
produce exactly ONE digest proposal for human review.

What counts as new:
- New blog posts, news, or announcements
- New products, collections, or pricing changes
- Notable recent mentions of the brand (use web_search sparingly, 2-3 queries max)

Workflow:
1. Call crawl_competitor with the target's domain to get fresh content.
2. Call get_last_snapshot with the target_id to retrieve previous content.
3. Diff: identify items present now that were NOT in the previous snapshot. Ignore
   boilerplate (nav, footer, repeated taglines).
4. Optionally use web_search 2-3 times for recent press/news.
5. Call emit_proposal EXACTLY ONCE with:
   - type: "competitor_report"
   - title: e.g. "<Brand>: 2 new blog posts, 1 price change"
   - summary: 2-4 sentences on the most important changes
   - payload: { newItems: [{type, title, url}], priceChanges: [...], mentions: [...], diffNotes: string }

If nothing changed, still emit one proposal with a "no changes detected" summary
and an empty payload — the human can mark it read.

Constraints:
- You have NO write tools — you only report.
- Do not invent items not present in the crawl or search results. Cite URLs.
- Be concise. The human reads many of these.`;

function buildTools() {
  const tools = [crawlCompetitor, getLastSnapshotTool];
  if (webSearchAvailable()) tools.push(webSearch);
  return tools;
}

export const competitorAgent = {
  type: "competitor",
  name: "Competitor Intelligence",
  systemPrompt: SYSTEM,
};

/**
 * Iterate over enabled targets. One agent_run per target. Snapshots are saved
 * deterministically before the LLM call so we always have history.
 */
export async function runCompetitorAgent({ agentId }) {
  const targets = await listTargets({ enabledOnly: true });
  const results = [];

  if (!targets.length) {
    console.log("[competitor] no enabled targets — nothing to do.");
    return results;
  }

  const tools = buildTools();

  for (const target of targets) {
    const run = await createRun({ agentId });
    try {
      await appendLog(run.id, {
        type: "reasoning",
        content: { event: "target_start", targetId: target.id, name: target.name, domain: target.domain },
      });

      // Deterministic snapshot capture first — even if the LLM call fails later,
      // we still record what the site looked like today.
      const crawl = await crawlCompetitor.execute({ domain: target.domain });
      let captured = 0;
      for (const p of crawl.pages || []) {
        if (p.content && !p.error) {
          await saveSnapshot({ targetId: target.id, url: p.url, content: p.content });
          captured++;
        }
      }
      await appendLog(run.id, {
        type: "reasoning",
        content: { event: "snapshots_captured", count: captured, engine: crawl.engine },
      });

      const input = [
        {
          type: "text",
          text:
            `Target: ${target.name} (${target.domain})\n` +
            `target_id: ${target.id}\n\n` +
            `Produce exactly one competitor_report proposal following your workflow. ` +
            `Snapshots from today's crawl have already been stored; the agent's job is to ` +
            `compare what you fetch now against the prior snapshot via get_last_snapshot.`,
        },
      ];

      const { proposals, totalCostUsd, iterations } = await runAgent({
        agentId,
        run,
        tools,
        system: SYSTEM,
        input,
      });

      await updateRun(run.id, {
        status: "success",
        finishedAt: new Date().toISOString(),
        costUsd: totalCostUsd,
        proposalCount: proposals.length,
        tokenUsage: { iterations },
      });
      results.push({ targetId: target.id, runId: run.id, proposals });
    } catch (err) {
      await appendLog(run.id, {
        type: "reasoning",
        content: { event: "error", message: err.message },
      });
      await updateRun(run.id, {
        status: "error",
        finishedAt: new Date().toISOString(),
        error: err.message,
      });
      results.push({ targetId: target.id, runId: run.id, error: err.message });
    }
  }

  return results;
}
