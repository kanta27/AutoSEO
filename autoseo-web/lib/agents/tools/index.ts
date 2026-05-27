// Tool definition types shared by every agent. A "tool" is one thing the LLM
// can call inside its loop — a typed JSON contract + a server-side execute fn.
//
// Tools must never throw out of `execute`. If the underlying operation can
// fail (network, missing config, bad args), return a structured error object
// so the LLM can read it back as a normal tool result and adapt. The runner
// only catches truly-unexpected throws as a safety net.
import "server-only";

import type OpenAI from "openai";
import type { Company } from "@/lib/supabase/types";

export type ToolContext = {
  agentKey: string;
  company: Company;
  // Filled in by the runner before each tool call so logging can attribute
  // a result to the step that produced it.
  step: number;
};

export type ToolResult = {
  ok: boolean;
  // Free-form JSON-safe payload the LLM sees as the tool's reply.
  data: unknown;
  // Optional human-readable label for the activity log.
  log_summary?: string;
};

export type AgentTool = {
  name: string;
  description: string;
  // JSON-Schema — passed straight through to OpenAI/Gemini's `tools.function.parameters`.
  parameters: Record<string, unknown>;
  // Set to true if calling this tool should end the agent loop (the runner
  // returns the call's result as the agent's output). Used for terminal
  // submission tools like `submit_article`.
  terminal?: boolean;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
};

// Convenience: turn an AgentTool[] into the OpenAI/Gemini `tools` parameter.
export function toOpenAITools(tools: AgentTool[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    },
  }));
}
