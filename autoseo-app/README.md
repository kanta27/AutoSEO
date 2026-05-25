# AutoSEO — audit & fix

Enter a URL → the app fetches the page, runs an **audit swarm** of rule-based
checks, **prioritizes** the findings into an overall score, and (optionally) uses
**Claude** to write copy-paste-ready fixes. This is the working core of the
AutoSEO/AutoGEO spec (`../autoseo_autogeo.md`): audit swarm → prioritizer → solver swarm.

## Run it

```bash
cd autoseo-app
npm install
npm start          # → http://localhost:3000
```

To enable AI-written fixes, set an Anthropic API key first:

```bash
# PowerShell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
npm start

# bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Without a key the app still works fully — the solver returns deterministic
rule-based fixes instead of AI-written ones.

## What it checks

| Auditor (spec ref) | Looks at |
|---|---|
| On-Page (A3) | title, meta description, H1, heading order, image alt, content depth, canonical |
| Technical (A1/A2) | HTTPS, status, redirect chain, noindex, robots.txt, viewport, lang, charset, page weight/speed, sitemap |
| Schema (A4) | JSON-LD presence, validity, type coverage, FAQ opportunity |
| GEO / AI-visibility (A10) | answer-first TL;DR, quotable stats up top, Q&A headings, lists/tables, author + date |
| Social | Open Graph + Twitter card completeness |

## Solver (Claude)

Findings tagged with a `solver` hint are sent to Claude in one structured call
(S1 Meta Rewriter, S2 Schema Injector, S7 GEO Optimizer). The system prompt is
prompt-cached. Output is returned via a tool schema so it's reliably structured.

## Layout

```
server.js              Express: serves /public, exposes POST /api/audit
src/fetch.js           server-side page + robots.txt fetch
src/auditors/*.js      the rule-based audit swarm
src/prioritize.js      scoring + overall grade
src/solver.js          Claude (with deterministic fallback)
src/audit.js           orchestrator
public/                the UI
```

## Next agents from the spec to layer on

Same primitives extend to: A5 Rank Tracker / A6 Keyword-Gap / A8 Backlinks (add
DataForSEO in a new `src/sources/`), S3 Internal-Linker, S11 PR Router (open a
GitHub PR with the diffs instead of showing copy-paste blocks), and scheduled
background re-audits.
```
