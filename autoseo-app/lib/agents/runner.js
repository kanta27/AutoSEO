// Generic Claude tool-use loop. Every agent reuses this. The agent supplies:
//   - system prompt
//   - tool registry (mix of "local" tools with an .execute fn and "server-side"
//     tools like Anthropic web_search that have only a .definition)
//   - input — the initial user message content (string or array of blocks)
//
// Agents emit findings via the always-registered `emit_proposal` tool. The
// runner records every reasoning text, tool_call, and tool_result to agent_logs
// so the dashboard can replay what happened.

import { chat } from "../llm/client.js";
import { appendLog } from "../storage/logs.js";
import { createProposal } from "../storage/proposals.js";

const MAX_ITERATIONS = 10;

const EMIT_PROPOSAL_TOOL = {
  name: "emit_proposal",
  description:
    "Record a proposal for human review. Call this when you have a complete finding to report. " +
    "You can call it more than once if you have multiple distinct proposals.",
  input_schema: {
    type: "object",
    properties: {
      type: { type: "string", description: "Proposal type, e.g. 'competitor_report'." },
      title: { type: "string", description: "One-line summary visible in the queue." },
      summary: { type: "string", description: "2-4 sentences explaining what changed and why it matters." },
      payload: { type: "object", description: "Full structured data backing the proposal." },
    },
    required: ["type", "title", "summary", "payload"],
  },
};

function toolDefinition(t) {
  if (t.definition) return t.definition; // server-side tools carry a typed definition
  return { name: t.name, description: t.description, input_schema: t.input_schema };
}

/**
 * Run the agent loop. Returns { proposals, totalCostUsd, iterations }.
 */
export async function runAgent({ agentId, run, tools, system, input }) {
  const localTools = new Map(tools.filter((t) => typeof t.execute === "function").map((t) => [t.name, t]));
  const toolDefs = [...tools.map(toolDefinition), EMIT_PROPOSAL_TOOL];

  const messages = [{ role: "user", content: input }];
  const proposals = [];
  let lastCostTotal = 0;

  await appendLog(run.id, { step: 0, type: "reasoning", content: { event: "start", agentId } });

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const resp = await chat({ system, messages, tools: toolDefs });
    lastCostTotal = resp.__totalToday;

    // Surface reasoning text so the dashboard can show it.
    for (const block of resp.content || []) {
      if (block.type === "text" && (block.text || "").trim()) {
        await appendLog(run.id, { step: iter, type: "reasoning", content: { text: block.text } });
      }
    }

    if (resp.stop_reason !== "tool_use") {
      await appendLog(run.id, {
        step: iter,
        type: "reasoning",
        content: { event: "end", stop_reason: resp.stop_reason, costUsd: resp.__cost },
      });
      return { proposals, totalCostUsd: lastCostTotal, iterations: iter + 1 };
    }

    const toolResults = [];
    for (const block of resp.content) {
      if (block.type !== "tool_use") continue;

      await appendLog(run.id, {
        step: iter,
        type: "tool_call",
        content: { name: block.name, input: block.input, toolUseId: block.id },
      });

      let result;
      let isError = false;
      try {
        if (block.name === "emit_proposal") {
          const p = await createProposal({ agentId, runId: run.id, ...block.input });
          proposals.push(p);
          result = { ok: true, proposalId: p.id };
        } else {
          const tool = localTools.get(block.name);
          if (!tool) throw new Error("Unknown tool: " + block.name);
          result = await tool.execute(block.input);
        }
      } catch (err) {
        result = { error: err.message };
        isError = true;
      }

      await appendLog(run.id, {
        step: iter,
        type: "tool_result",
        content: { name: block.name, result, isError, toolUseId: block.id },
      });

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        is_error: isError,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }

    messages.push({ role: "assistant", content: resp.content });
    messages.push({ role: "user", content: toolResults });
  }

  throw new Error(`Agent exceeded ${MAX_ITERATIONS} iterations without finalizing.`);
}
