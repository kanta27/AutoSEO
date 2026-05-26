// Server-only LLM client. Calls Kimi 2.5 (or whatever AUTOSEO_MODEL points at)
// through the MeshAPI gateway — an OpenAI-compatible router for 300+ models.
// The key NEVER reaches the browser; every caller is an /api/ route or a
// server component running on the server.
import "server-only";
import OpenAI from "openai";

// MeshAPI default — overridable via env so the gateway endpoint can change
// without code edits. Confirmed from meshapi.ai: "Set base_url to
// https://api.meshapi.ai/v1 and swap your API key for your Mesh key."
const DEFAULT_BASE_URL = "https://api.meshapi.ai/v1";
// Best-inference slug for Kimi 2.5. The HF/Together convention is
// `moonshotai/Kimi-K2.5`; override AUTOSEO_MODEL in .env.local if your
// MeshAPI dashboard shows a different slug.
const DEFAULT_MODEL = "moonshotai/Kimi-K2.5";

export const LLM_MODEL = process.env.AUTOSEO_MODEL || DEFAULT_MODEL;
export const LLM_BASE_URL = process.env.MESHAPI_BASE_URL || DEFAULT_BASE_URL;

let cached: OpenAI | null = null;

export function llm(): OpenAI {
  if (cached) return cached;
  const apiKey = process.env.MESHAPI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "MESHAPI_API_KEY is not set. Add it to .env.local (chat and onboarding need it)."
    );
  }
  cached = new OpenAI({ apiKey, baseURL: LLM_BASE_URL });
  return cached;
}

export function hasLlmKey(): boolean {
  return Boolean(process.env.MESHAPI_API_KEY);
}
