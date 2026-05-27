// Shared agent runner — the same code path every agent (blog, SEO-fix,
// GEO-fix, LinkedIn, Competitor) uses to think.
//
// Mental model: the LLM drives a loop. Each step it can either (a) call one
// or more tools to gather info / submit results, or (b) emit a final text
// message and stop. We cap the number of round-trips to bound cost.
//
// One terminal tool can also end the loop early — useful for "submit_X"
// tools where the proposal IS the result and there's nothing left to say.
//
// Every step is persisted to `agent_logs` so debugging a misbehaving agent
// is reading rows, not parsing stdout.
import "server-only";

import type OpenAI from "openai";
import { llm, LLM_MODEL } from "@/lib/llm";
import { supabaseServer } from "@/lib/supabase/server";
import type { Company } from "@/lib/supabase/types";
import { type AgentTool, type ToolResult, toOpenAITools } from "./tools";

export type AgentRunInput = {
  agentKey: string;
  company: Company;
  systemPrompt: string;
  tools: AgentTool[];
  maxSteps?: number;
  // Persist per-step trace to agent_logs under this run id. Optional so the
  // runner can be invoked from places without a parent agent_runs row (tests).
  runId?: string;
};

export type AgentRunOutput = {
  // Last terminal-tool result, OR the final assistant text message.
  result: ToolResult | { ok: true; data: { text: string }; log_summary?: string } | null;
  steps: number;
  budgetExhausted: boolean;
  failureReason: string | null;
};

const DEFAULT_MAX_STEPS = 6;

export async function runAgent(input: AgentRunInput): Promise<AgentRunOutput> {
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const oaTools = toOpenAITools(input.tools);
  const byName = new Map(input.tools.map((t) => [t.name, t]));

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: input.systemPrompt },
  ];

  let lastTerminalResult: ToolResult | null = null;
  let step = 0;

  while (step < maxSteps) {
    step += 1;

    // 1) Ask the LLM what to do next.
    let completion: OpenAI.Chat.ChatCompletion;
    try {
      completion = await llm().chat.completions.create({
        model: LLM_MODEL,
        messages,
        tools: oaTools.length ? oaTools : undefined,
        tool_choice: oaTools.length ? "auto" : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logStep(input.runId, step, "error", { phase: "llm_call", error: msg });
      return { result: null, steps: step, budgetExhausted: false, failureReason: msg };
    }

    const msg = completion.choices[0]?.message;
    if (!msg) {
      await logStep(input.runId, step, "error", { phase: "empty_choice" });
      return {
        result: null,
        steps: step,
        budgetExhausted: false,
        failureReason: "LLM returned no choice.",
      };
    }
    // Push the assistant message so subsequent role:"tool" replies can
    // reference its tool_call_ids.
    messages.push(msg);

    // 2) If there are no tool calls, the LLM is done — return the text.
    if (!msg.tool_calls?.length) {
      const text = typeof msg.content === "string" ? msg.content : "";
      await logStep(input.runId, step, "final", { text });
      return {
        result: { ok: true, data: { text } },
        steps: step,
        budgetExhausted: false,
        failureReason: null,
      };
    }

    // 3) Execute each requested tool. We process serially per call so the
    //    trace ordering is deterministic; parallel could surprise the LLM
    //    by interleaving tool_call_ids it ordered. The OpenAI SDK v6 union
    //    includes a "custom" tool-call variant we never emit — narrow to
    //    function calls explicitly.
    const functionCalls = msg.tool_calls.filter(
      (c): c is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => c.type === "function",
    );
    for (const call of functionCalls) {
      const tool = byName.get(call.function.name);
      if (!tool) {
        const result = {
          ok: false,
          data: { error: `Unknown tool: ${call.function.name}` },
        };
        await logStep(input.runId, step, "tool_result", { call: call.function.name, result });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result.data),
        });
        continue;
      }

      let args: Record<string, unknown>;
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        const result = {
          ok: false,
          data: { error: "Could not parse tool arguments as JSON." },
        };
        await logStep(input.runId, step, "tool_result", { call: tool.name, result });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result.data),
        });
        continue;
      }

      await logStep(input.runId, step, "tool_call", { name: tool.name, args });
      let result: ToolResult;
      try {
        result = await tool.execute(args, {
          agentKey: input.agentKey,
          company: input.company,
          step,
        });
      } catch (err) {
        // Tools shouldn't throw, but if they do we don't crash the run —
        // we hand the error back to the LLM as a normal tool result so it
        // can either retry or move on.
        const errMsg = err instanceof Error ? err.message : String(err);
        result = { ok: false, data: { error: errMsg } };
      }
      await logStep(input.runId, step, "tool_result", { name: tool.name, result });

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        // Bound payload size so a chatty tool doesn't blow the context window.
        content: JSON.stringify(result.data).slice(0, 8000),
      });

      if (tool.terminal && result.ok) {
        // Terminal tools mark the natural end of the loop: the agent has
        // produced its deliverable, no point asking the LLM to keep going.
        lastTerminalResult = result;
        return {
          result: lastTerminalResult,
          steps: step,
          budgetExhausted: false,
          failureReason: null,
        };
      }
    }
  }

  await logStep(input.runId, step, "error", {
    phase: "budget_exhausted",
    max_steps: maxSteps,
  });
  return {
    result: null,
    steps: step,
    budgetExhausted: true,
    failureReason: `Step budget exhausted after ${maxSteps} steps without a terminal result.`,
  };
}

async function logStep(
  runId: string | undefined,
  step: number,
  role: "plan" | "tool_call" | "tool_result" | "final" | "error",
  content: Record<string, unknown>,
): Promise<void> {
  if (!runId) return;
  try {
    await supabaseServer().from("agent_logs").insert({
      run_id: runId,
      step,
      role,
      content,
    });
  } catch {
    // Logging must NEVER take down the run. Swallow.
  }
}
