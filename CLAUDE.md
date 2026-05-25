# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this directory is

`autoseo_resources/` holds everything for **AutoSEO.live** — an autonomous SEO + GEO (Generative Engine Optimization) product. It is not a single app; it has four parts, only one of which is live code:

- **`autoseo-app/`** — the working application (Node + Express). This is the active codebase; almost all development happens here.
- **`autoseo_autogeo.md`** — the product/architecture **spec**. It is the north star: the app's auditors and solvers are deliberately named after agents in this doc (audit swarm `A1`–`A14`, solver swarm `S1`–`S12`, plus a Prioritizer/Planner orchestration layer). Read §3 before adding an auditor or solver so naming and scope stay consistent.
- **`autoseo-site/`** — the static marketing landing page (`index.html`, deployed to Vercel). Its two "Deploy agent" forms hand off to the app via `window.AUTOSEO_APP + "/?url=" + encodeURIComponent(url)` (set near the bottom of `index.html`). The app auto-runs an audit when it receives `?url=`.
- **`design_bundle/`** — read-only Claude Design export (HTML/JSX mockups + chat transcript). Reference for design intent only; not built or imported.

## Commands (run inside `autoseo-app/`)

```bash
npm install                                  # once
npm start                                    # serve on http://localhost:3000
npm run dev                                  # same, with --watch auto-restart
npm run fix path/to/file.html                # audit + auto-rewrite a local file
npm run fix path/to/file.html -- --dry-run   # report only, no writes
```

- `ANTHROPIC_API_KEY` (env) enables Claude-written fixes; without it the solver returns deterministic fallbacks and the app still fully works. `/api/health` reports whether the key is set.
- `PORT` overrides 3000 (PowerShell: `$env:PORT=3001; npm start`). If 3000 is busy the server prints a clear message and exits 1 rather than dumping a stack trace.
- `AUTOSEO_MODEL` overrides the Claude model (default `claude-sonnet-4-6`).
- `AUTOSEO_FIXES_ROOT` (env) — when set, `POST /api/autofix` is enabled and constrained to that directory (resolves the request's `filePath` under this root and rejects traversal). When unset, the endpoint returns 403; the CLI is unaffected.
- `AUTOSEO_PUBLIC_ENDPOINT` (env) — the URL baked into the always-on agent so it phones home to the right host. Defaults to `http://localhost:$PORT`; set to e.g. `https://api.autoseo.live` in production.
- `AUTOSEO_DATA_DIR` (env, default `data`) — where the registry (`registry.json`) and per-key fix caches (`fixes/<key>/*.json`) live. Gitignored.
- `AUTOSEO_CACHE_TTL_HOURS` / `AUTOSEO_REFRESH_HOURS` / `AUTOSEO_DISABLE_SCHEDULER` — control the stale-while-revalidate window and the background scheduler.
- There is **no test suite, linter, or build step**. Validate changes by running the server and auditing real URLs, e.g. `curl -s -X POST http://localhost:3000/api/audit -H "Content-Type: application/json" -d '{"url":"example.com"}'`, and validate auto-fix end-to-end via `npm run fix test-fixtures/broken.html`.

## Architecture of `autoseo-app/`

ESM throughout (`"type": "module"`). Node 18+ for global `fetch`. The whole app is one synchronous pipeline orchestrated by `src/audit.js` (`runAudit`):

```
fetch.js          → fetchPage (manual redirect-following, robots.txt, timing) + cheerio parse
auditors/*.js     → audit swarm: each exports one fn (ctx) → finding[]
prioritize.js     → score findings, roll up 0–100 + letter grade + per-category breakdown
solver.js         → solve(): Claude (or deterministic fallback) → copy-paste-ready fixes
applier.js        → applyFixes(html, fixes): cheerio-based, idempotent, writes the
                    solver output back into HTML for the auto-fix flow
```

`runAudit` takes either `string|{url}` (URL mode, fetches via `fetch.js`) **or** `{html, sourceUrl}` (local-file mode, skips the fetch and synthesizes a minimal page envelope with https=true so local files aren't penalized for missing TLS). Both modes flow through the same auditor/prioritizer/solver pipeline.

`server.js` exposes three surfaces:
- `POST /api/audit` ({ url, withFixes }) — the on-demand audit (used by the browser UI). When `withFixes` is true it also **auto-registers the domain** via `src/registry.js`, caches the structured fixes via `src/cache.js`, and adds an `automatic: { apiKey, scriptUrl, snippet, installScript }` block to the response so the UI can offer the always-on install in one click.
- `POST /api/autofix` ({ filePath, dryRun, backup }) — disk-writing path-restricted under `AUTOSEO_FIXES_ROOT`.
- `/v1/*` — the always-on hosted API the embedded agent talks to: `POST /v1/register`, `GET /v1/fixes?key=&url=` (stale-while-revalidate; CORS-enabled; the hot path called from every customer page load), `POST /v1/refresh?key=`, and `GET /v1/agent.js?key=` (returns the runtime snippet with the key + `AUTOSEO_PUBLIC_ENDPOINT` baked in).

### Always-on mode (`/v1` API)

The product flow is: user audits → `/api/audit` auto-registers their domain and returns an API key + a one-line `<script>` snippet + a downloadable `autoseo-install.mjs`. They install the snippet once; from then on, every page load calls `/v1/fixes` and the embedded agent patches `title`/`meta`/`og`/`schema`/`tldr` into the DOM. `src/scheduler.js` re-audits every registered URL every `AUTOSEO_REFRESH_HOURS` (default 24) in the background, so the cache stays fresh without the user redeploying.

Key invariants:
- **One key per domain** (`src/registry.js`). Re-registering is idempotent.
- **Keys are domain-scoped** — `/v1/fixes` rejects requests whose URL hostname doesn't match the key's domain.
- **`src/structurize.js`** is the boundary between the solver's flat fix array (raw HTML strings) and the structured JSON the agent consumes (no HTML, just fields). Any new `solver.type` needs a matching case here.
- **Templates** (`templates/agent.template.js`, `templates/autoseo-install.template.mjs`, `templates/autoseo-fix.template.mjs`) carry `/*__AUTOSEO_…__*/ <default>` placeholders; `src/generator.js` injects per-customer payloads at request time. Edit the templates as real files — don't string-concatenate inside `generator.js`.

The browser UI in `public/` (vanilla `app.js`, no framework, no bundler) renders both modes: the "⚡ Make it automatic" panel with the snippet + installer (primary) and the one-shot fix download (secondary). `bin/autofix.js` is the standalone CLI for the one-shot auto-fix flow (no server needed).

### The Finding object is the contract

Every auditor pushes findings of this shape; the rest of the pipeline depends on it:

```js
{ agent, category, id, severity, title, detail?, evidence?, solver? }
```

- `severity` is one of `critical | high | medium | low | good`. `good` findings are positive signals — excluded from the issue list but counted toward the score. Severity → numeric weight lives **only** in `prioritize.js` (`SEVERITY` map); the score is `100 − Σ(weight)×2`, clamped 0–100.
- `category` must be a key in `prioritize.js`'s `CATEGORY_LABEL` or it won't appear in the breakdown.
- `solver` (optional) is the bridge to the Claude step: `{ type, current, hint? }` where `type ∈ {title, description, schema, tldr, og}`. `solver.js` collects these, de-dupes by `type`, and asks Claude to generate all of them in one structured (tool-schema) call with a prompt-cached system prompt. Every `type` must have a matching branch in `ruleBasedFix()` so the no-API-key path still works.

### Adding capability

- **New check** → add to an existing `auditors/*.js` (or a new file wired into `src/audit.js`'s `findings` array). Attach a `solver` hint if Claude should generate the fix.
- **New fix type** → extend the `solver.type` enum in `solver.js`'s `TOOL` schema, the `SYSTEM` rules, and `ruleBasedFix()`.
- **New data source** (DataForSEO rank/keyword/backlinks per spec §2) → add under a new `src/sources/` dir; keep it out of the per-page synchronous pipeline.

The spec's later agents (Rank Tracker A5, Keyword-Gap A6, Backlinks A8, the S11 PR Router that opens a GitHub PR instead of showing copy-paste blocks, scheduled re-audits) are intended to layer on these same primitives.
