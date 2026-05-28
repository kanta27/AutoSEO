// Marketing-skills loader. Reads vendored Agent Skills from the repo-root
// `skills/` directory and concatenates them into a reference-frameworks
// block that the Blog and Coding agents append to their system prompts.
//
// What a "skill" is here: a markdown playbook (`SKILL.md`) that gives the
// model structured frameworks for a specific marketing task — copy, schema,
// site architecture, etc. They are CONTEXT, not behaviour rules; the agent
// applies them with judgement.
//
// Why server-only: file reads use Node `fs` synchronously on first access
// per skill, then a module-level cache serves subsequent reads. The cache
// is process-wide, so for the typical Next.js dev/prod setup the file IO
// only happens once per server boot.
//
// Cost: a fully-loaded set of skills is ~12k tokens of prompt addition per
// agent run. Set SKILLS_ENABLED=false in env to disable and A/B compare.
import "server-only";

// Use the legacy import form (no `node:` prefix). Next.js's default webpack
// config doesn't handle the `node:` URI scheme for built-in modules in the
// server-build pipeline, even though the file is server-only.
import fs from "fs";
import path from "path";

// Per-skill body cap. The upstream `ai-seo` SKILL.md is ~25 KB; injecting it
// raw blows the context budget faster than it earns its keep, so we truncate
// at a heading boundary near this limit. Other skills land well under it.
const SKILL_BODY_CHAR_CAP = 12_000;

// Module-level cache: skill name → processed body. Survives across requests
// in the same Node process. The cache is keyed by name; if a SKILL.md file
// changes on disk, restart the server (or hot-reload picks it up).
const cache = new Map<string, string>();

// Resolves the absolute path to `<repo-root>/skills/<name>/SKILL.md`. The
// Next.js dev/build process runs from `autoseo-web/` (or a Vercel build root
// that contains `autoseo-web/`), so we walk up looking for the `skills/`
// directory rather than hard-coding a `..` count.
function resolveSkillsRoot(): string {
  // Walk up from cwd looking for a sibling `skills/` directory. Stops at the
  // filesystem root. In typical layouts this resolves in one or two iterations.
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, "skills");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume cwd is autoseo-web/ and skills/ is its sibling.
  return path.join(process.cwd(), "..", "skills");
}

const SKILLS_ROOT = resolveSkillsRoot();

// Strip a YAML frontmatter block of the form `---\n…\n---\n` from the top
// of a markdown file. The agent doesn't need the spec metadata, just the
// body. If no frontmatter exists, returns the input unchanged.
function stripFrontmatter(source: string): string {
  // Permit a UTF-8 BOM or leading whitespace before the opening `---`.
  const stripped = source.replace(/^﻿/, "");
  if (!stripped.startsWith("---")) return source;
  // Find the closing `---` on its own line. Multiline match — the body
  // between the two delimiters can contain anything.
  const match = stripped.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return source;
  return stripped.slice(match[0].length);
}

// Truncate at the last `##`/`###` heading boundary before the cap, so we
// never cut a section mid-sentence. If no boundary is found before the cap,
// fall back to a hard slice at the cap.
function truncateAtHeading(body: string, cap: number): string {
  if (body.length <= cap) return body;
  const slice = body.slice(0, cap);
  // Prefer cutting at a top-level `##` so each chunk is a coherent section.
  const lastH2 = slice.lastIndexOf("\n## ");
  const lastH3 = slice.lastIndexOf("\n### ");
  const cutAt = Math.max(lastH2, lastH3);
  const finalBody =
    cutAt > 0 ? slice.slice(0, cutAt).trimEnd() : slice.trimEnd();
  return `${finalBody}\n\n_(skill truncated — see skills/<name>/SKILL.md for full text)_`;
}

// Load one skill by name. Returns the stripped + size-capped body. Returns
// `null` (and warns once) when the file is missing — callers shouldn't crash
// over a missing skill since the app boots fine without skills.
export function loadSkill(name: string): string | null {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  const file = path.join(SKILLS_ROOT, name, "SKILL.md");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[skills] Could not read "${file}": ${err instanceof Error ? err.message : String(err)}. ` +
        `Continuing without this skill.`,
    );
    cache.set(name, ""); // sentinel: don't keep retrying
    return null;
  }

  const body = stripFrontmatter(raw).trim();
  let processed = body;
  if (body.length > SKILL_BODY_CHAR_CAP) {
    // eslint-disable-next-line no-console
    console.warn(
      `[skills] "${name}" body is ${body.length} chars (cap ${SKILL_BODY_CHAR_CAP}). Truncating at a heading boundary.`,
    );
    processed = truncateAtHeading(body, SKILL_BODY_CHAR_CAP);
  }
  cache.set(name, processed);
  return processed;
}

// Returns true unless SKILLS_ENABLED is explicitly the string "false"
// (case-insensitive). Default is on — skills are the whole point of this
// session, you shouldn't have to opt in.
export function skillsEnabled(): boolean {
  const v = (process.env.SKILLS_ENABLED ?? "").trim().toLowerCase();
  return v !== "false";
}

// Concatenate a list of skills into one reference-frameworks block ready to
// append to a system prompt. Returns an empty string when SKILLS_ENABLED is
// off OR when none of the named skills resolved on disk — so callers can
// always concat the result blindly.
export function loadSkills(names: string[]): string {
  if (!skillsEnabled()) return "";
  if (!names.length) return "";

  const sections: string[] = [];
  for (const name of names) {
    const body = loadSkill(name);
    if (!body) continue;
    sections.push(`---\n\n## Reference: ${name}\n\n${body}`);
  }
  if (!sections.length) return "";

  const preamble =
    `## Reference frameworks\n\n` +
    `The sections below are reference frameworks vendored from a curated marketing-skills library. ` +
    `Use them to inform your reasoning — do NOT blindly follow every step. Apply judgement based on ` +
    `this specific company, finding, and task. The earlier instructions in this prompt remain primary.`;

  return `${preamble}\n\n${sections.join("\n\n")}`;
}
