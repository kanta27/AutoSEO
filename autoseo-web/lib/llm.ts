// Server-only LLM client. Calls Groq through its OpenAI-compatible endpoint,
// so we keep using the `openai` npm package unchanged. The key NEVER reaches
// the browser; every caller is an /api/ route or a server component running
// on the server.
//
// Provider history:
//   • Prior to 2026-05-29 we used Google Gemini via its OpenAI-compat layer.
//     Gemini's free tier silently 400s on requests that include tool
//     definitions (confirmed across multiple keys + models), which broke
//     every agent that runs on runner.ts. We switched to Groq, whose
//     OpenAI-compat endpoint has genuine free-tier tool-calling support.
//   • If a future provider switch is needed, THIS FILE is the only one to
//     touch — every caller goes through `llm()` + `LLM_MODEL` + `LLM_PROVIDER`.
import "server-only";
import OpenAI from "openai";

// Verified from https://console.groq.com/docs/openai — Groq documents the
// base URL WITHOUT a trailing slash. The OpenAI SDK appends `/chat/completions`
// (with leading slash) so either form would resolve in practice, but we
// match the documented form to avoid surprises if Groq tightens routing.
const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
// llama-3.3-70b-versatile is Groq's current production flagship and the
// recommended default for general work + reliable tool calling on the free
// tier. Flip AUTOSEO_MODEL in .env.local to switch — no code change.
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

export const LLM_MODEL = process.env.AUTOSEO_MODEL || DEFAULT_MODEL;
export const LLM_BASE_URL = resolveBaseUrl();
export const LLM_PROVIDER = "groq";

let cached: OpenAI | null = null;

export function llm(): OpenAI {
  if (cached) return cached;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    // Migration helper: if the user still has GEMINI_API_KEY set from the
    // previous provider, point them at the rename rather than silently
    // failing with a confusing 401 from Groq.
    if (process.env.GEMINI_API_KEY) {
      throw new Error(
        "GEMINI_API_KEY is set but the LLM provider is now Groq. Rename it to GROQ_API_KEY in .env.local " +
          "(get a Groq key at https://console.groq.com — free, no credit card)."
      );
    }
    throw new Error(
      "GROQ_API_KEY is not set. Add it to .env.local (chat and onboarding need it). " +
        "Get a key at https://console.groq.com — free, no credit card."
    );
  }
  cached = new OpenAI({ apiKey, baseURL: LLM_BASE_URL });
  return cached;
}

export function hasLlmKey(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

// Resolves the base URL with a one-release back-compat fallback to the old
// GEMINI_BASE_URL env var. If only the old name is set we warn so the user
// migrates; if both are set, the Groq one wins (the new name is canonical).
function resolveBaseUrl(): string {
  const groq = process.env.GROQ_BASE_URL;
  if (groq) return groq;
  const legacy = process.env.GEMINI_BASE_URL;
  if (legacy) {
    // eslint-disable-next-line no-console
    console.warn(
      "[llm] GEMINI_BASE_URL is deprecated — rename to GROQ_BASE_URL in .env.local. " +
        "Using the legacy value for this release."
    );
    return legacy;
  }
  return DEFAULT_BASE_URL;
}
