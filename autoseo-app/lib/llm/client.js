// Single source of truth for Claude calls in the agent system. Centralizes:
//   - model constant (separate from the auditor solver's AUTOSEO_MODEL so the
//     two can be tuned independently)
//   - daily USD spend cap (hard-stops new calls past the cap)
//   - per-call cost tracking persisted to data/spend.json

import Anthropic from "@anthropic-ai/sdk";
import { readJson, writeJsonAtomic, dataPath } from "../storage/db.js";

export const MODEL = process.env.AUTOSEO_AGENT_MODEL || "claude-sonnet-4-6";

// Approximate USD per million tokens. Update when Anthropic changes pricing.
const PRICES = {
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-opus-4-7": { in: 15, out: 75 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
};

const SPEND_FILE = dataPath("spend.json");
const DAILY_CAP = parseFloat(process.env.DAILY_LLM_SPEND_CAP_USD || "5");

export class SpendCapExceededError extends Error {
  constructor(spent, cap) {
    super(`Daily LLM spend cap exceeded: $${spent.toFixed(4)} / $${cap.toFixed(2)}.`);
    this.code = "SPEND_CAP_EXCEEDED";
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function readSpend() {
  const data = await readJson(SPEND_FILE, { date: today(), spentUsd: 0, calls: 0 });
  if (data.date !== today()) return { date: today(), spentUsd: 0, calls: 0 };
  return data;
}

export async function getSpendToday() {
  const s = await readSpend();
  return { ...s, capUsd: DAILY_CAP };
}

async function trackCost(usage, model) {
  const price = PRICES[model] || PRICES["claude-sonnet-4-6"];
  const cost =
    ((usage?.input_tokens || 0) * price.in + (usage?.output_tokens || 0) * price.out) / 1_000_000;
  const cur = await readSpend();
  const next = { date: today(), spentUsd: cur.spentUsd + cost, calls: cur.calls + 1 };
  await writeJsonAtomic(SPEND_FILE, next);
  return { cost, total: next.spentUsd };
}

let _client = null;
function client() {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required.");
  _client = new Anthropic();
  return _client;
}

/**
 * One Claude request. Throws SpendCapExceededError if today's spend is already
 * at/over the cap (checked before the call so we never overshoot by much).
 */
export async function chat({ system, messages, tools, max_tokens = 2000, model = MODEL }) {
  const spend = await readSpend();
  if (spend.spentUsd >= DAILY_CAP) throw new SpendCapExceededError(spend.spentUsd, DAILY_CAP);

  const resp = await client().messages.create({
    model,
    max_tokens,
    system,
    messages,
    tools,
  });
  const { cost, total } = await trackCost(resp.usage, model);
  resp.__cost = cost;
  resp.__totalToday = total;
  return resp;
}
