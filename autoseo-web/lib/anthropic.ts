// Server-only Anthropic client. The key NEVER reaches the browser — every
// caller is an /api/ route or a server component running on the server.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_MODEL = process.env.AUTOSEO_MODEL || "claude-sonnet-4-6";

let cached: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (cached) return cached;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local (chat and onboarding need it)."
    );
  }
  cached = new Anthropic();
  return cached;
}

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
