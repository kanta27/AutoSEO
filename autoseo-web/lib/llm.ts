// Server-only LLM client. Calls Google Gemini through its OpenAI-compatible
// endpoint, so we keep using the `openai` npm package unchanged. The key NEVER
// reaches the browser; every caller is an /api/ route or a server component
// running on the server.
import "server-only";
import OpenAI from "openai";

// Verified 2026-05 from https://ai.google.dev/gemini-api/docs/openai — note
// the trailing slash; the OpenAI SDK appends paths to this verbatim, so
// dropping the slash would break /chat/completions resolution.
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
// gemini-2.5-flash has the AI Studio free tier; gemini-3.5-flash is the
// newer paid GA (released 2026-05-19). Flip AUTOSEO_MODEL in .env.local to
// switch — no code change.
const DEFAULT_MODEL = "gemini-2.5-flash";

export const LLM_MODEL = process.env.AUTOSEO_MODEL || DEFAULT_MODEL;
export const LLM_BASE_URL = process.env.GEMINI_BASE_URL || DEFAULT_BASE_URL;
export const LLM_PROVIDER = "gemini";

let cached: OpenAI | null = null;

export function llm(): OpenAI {
  if (cached) return cached;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local (chat and onboarding need it)."
    );
  }
  cached = new OpenAI({ apiKey, baseURL: LLM_BASE_URL });
  return cached;
}

export function hasLlmKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}
