# Skills (vendored)

This directory contains **vendored, curated** Agent Skills from
[coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)
(MIT-licensed — see `LICENSE`).

A Skill is a markdown playbook (`SKILL.md`) that gives an LLM a structured way
to reason about a specific marketing task. The autoseo-web agents load these
files at runtime and append them to the agent's system prompt as **reference
frameworks** — not training, not rules to follow blindly. The agent applies
judgement based on the specific company and task.

## What's vendored

Six skills, hand-picked for the two agentic loops that currently run on the
shared `runner.ts` (the Blog agent and the Coding agent's SEO/GEO synthesis
path):

| Skill                | Used by                                    | Why |
|----------------------|--------------------------------------------|-----|
| `copywriting/`       | Blog agent                                 | Frameworks for clear, conversion-oriented marketing copy. |
| `content-strategy/`  | Blog agent                                 | What to write about, for whom, in what order. |
| `seo-audit/`         | Blog agent, Coding (SEO/GEO handoff)       | What "SEO-structured" actually means at the page level. |
| `ai-seo/`            | Blog agent, Coding (SEO/GEO handoff)       | Writing content that's citable by ChatGPT / Perplexity / AI Overviews — the GEO thesis. |
| `schema/`            | Coding (SEO/GEO handoff)                   | JSON-LD synthesis for structured-data PRs. |
| `site-architecture/` | Coding (SEO/GEO handoff)                   | How internal links + page topology shape rank — feeds the PR rationale. |

Skills are loaded by `autoseo-web/lib/agents/skills.ts`. The `SKILL.md` body
(with YAML frontmatter stripped) is concatenated into the agent's system
prompt under a `## Reference frameworks` heading.

`references/` and `evals/` subdirs are kept for repo completeness but are NOT
injected into agent context. Humans who want to read the supporting material
(framework details, example prompts, eval cases) can browse them here.

## Curation rules

- **Hand-picked.** Don't blindly sync upstream. We vendor only what a specific
  agent needs. Adding a new skill = its own deliberate session.
- **No transformation.** The vendored `SKILL.md` files are byte-for-byte from
  upstream so future manual updates are a clean `git diff`.
- **Truncation is runtime-only.** `skills.ts` truncates oversized bodies at a
  heading boundary when building the system prompt — the on-disk files are
  unchanged.

## Toggling skills

Set `SKILLS_ENABLED=false` in `autoseo-web/.env.local` to make `loadSkills(...)`
return an empty string. Useful for A/B comparing output quality with vs.
without the framework context, or for clamping token cost if needed.

## Updating

This is a vendored copy, not a submodule. To pick up upstream improvements:

1. Compare the upstream `SKILL.md` for each vendored skill against the local copy.
2. Review the diff manually — upstream tone, structure, or focus may have
   shifted in ways that don't match this app's agents.
3. Update the local file. No tooling, no auto-merge.

Upstream commit at vendoring time:
`https://github.com/coreyhaines31/marketingskills/tree/main/skills`

## License + attribution

The vendored content is © Corey Haines, MIT-licensed. See `LICENSE` for the
full license text. Any modifications we make to a `SKILL.md` (currently: none)
must preserve the license header.
