# autoseo-web

The unified web front door for AutoSEO.live — landing, onboarding, and the
four-panel dashboard (Company · Analytics · Actions Feed · AI CMO chat). It is
the *application layer*; the actual SEO/GEO work happens in two engines this
app calls:

- **`../autoseo-app`** — Node Express server that runs the audit pipeline,
  generates fixes, and exposes `POST /api/audit`. This app calls it over HTTP.
- **`../autoseo-agents`** — Python LangGraph brand swarm (research → audit →
  geo_visibility → strategy → monitor). Wired only as a typed stub this
  session (`lib/engines/python-swarm.ts`).

---

## What's wired this session

- Landing page (`/`) with the URL onboarding form + agent grid.
- `POST /api/onboard` — audits the URL via the Node engine, asks the LLM
  (Gemini via its OpenAI-compatible endpoint) to infer name/description/
  brand-voice/product-info, creates the company + documents, seeds the
  Actions Feed with the audit summary, redirects to the dashboard.
- Dashboard (`/dashboard`) — 4-panel layout pulling live from Supabase.
- `POST /api/agents/seo/run` — re-runs the SEO/GEO audit, turns each finding
  into a `proposals` row, records an `agent_runs` row.
- `POST /api/proposals/:id` — Approve/Reject (status flip only; real publish
  actions land in a later session).
- `POST /api/chat` — streamed LLM reply (SSE; Gemini via OpenAI-compatible
  endpoint) grounded on the live company context (company + pending proposals
  + latest audit + documents).

## What's NOT wired this session (separate future prompts)

- Daily cron scheduler across all enabled agents.
- Reddit / X / LinkedIn / HN / Writer / UGC agents.
- Real publish actions (GitHub PR / CMS write).
- Multi-tenant auth + billing (single-tenant for now, server-side service-role).
- Real GSC / GA4 connectors in the Analytics panel.
- Wiring the Python swarm into the "Run" button (currently a stub).
- Collapsing `../autoseo-app/lib/` (its own JSON-file agent system) into this
  Supabase schema. They run side-by-side; the two proposal stores are separate.

---

## Setup

### 1. Database

In your Supabase project's SQL editor, paste `supabase/migrations/0001_init.sql`
and run it. This creates `companies`, `documents`, `agents`, `proposals`,
`agent_runs` and seeds the agent catalog (SEO/GEO/Coding live; Reddit/X/LinkedIn/
HN/Writer/UGC as `coming_soon`).

### 2. Environment

Copy `.env.example` to `.env.local` and fill in:

```env
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi…                                       # service-role, server-only
GEMINI_API_KEY=AIza…                                                         # get at https://aistudio.google.com/apikey
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/     # default; trailing slash required
AUTOSEO_MODEL=gemini-2.5-flash                                               # see model note below
NODE_ENGINE_URL=http://localhost:3000                                        # autoseo-app default
```

> **About the model:** `gemini-2.5-flash` has the [Google AI Studio free
> tier](https://aistudio.google.com/apikey) — the default. `gemini-3.5-flash`
> is the newer paid GA (released 2026-05-19, $1.50 in / $9.00 out per 1M
> tokens). Flip `AUTOSEO_MODEL` in `.env.local` to switch; no code change.

### 3. Run all three processes

```powershell
# Terminal 1 — Node SEO engine (audit + fixes)
cd autoseo-app
npm install        # once
npm start          # http://localhost:3000

# Terminal 2 — Next.js front door
cd autoseo-web
npm install        # once
npm run dev        # http://localhost:3001

# Terminal 3 (OPTIONAL, not wired into the dashboard yet) — Python swarm
cd autoseo-agents
py -3 -m pip install -r requirements.txt
py -3 main.py --target targets/example.json -v
```

Open <http://localhost:3001>, enter any URL, and you'll land on the dashboard
with one audit summary in the Actions Feed. Click **Run SEO + GEO audit** to
generate more proposals.

---

## Architecture

```
Browser
  │
  ▼
autoseo-web (Next.js, this app)
  ├── app/page.tsx              landing (SSR from `agents`)
  ├── app/dashboard/page.tsx    4 panels (SSR from company + proposals)
  ├── app/api/onboard           audit + classify + insert company/docs
  ├── app/api/agents/seo/run    audit → proposals[]
  ├── app/api/proposals/[id]    decide() flips status
  ├── app/api/chat              streamed LLM reply over SSE
  ├── lib/supabase/server.ts    service-role client (server-only)
  ├── lib/llm.ts                Gemini client (OpenAI SDK + compat URL, server-only)
  ├── lib/engines/node-audit.ts → POST autoseo-app/api/audit
  ├── lib/engines/python-swarm  STUB (future session)
  └── lib/proposals.ts          AuditReport → NewProposal[]
        │
        ▼
   Supabase (Postgres)
   ├── companies, documents
   ├── agents (seeded catalog)
   ├── proposals (Actions Feed source of truth)
   └── agent_runs (audit invocations)
        ▲
        │   HTTP
        │
autoseo-app (Node Express, the SEO/GEO engine)
   ├── POST /api/audit          ← what this app calls
   ├── runAudit() — auditors/* → prioritize → solver (its own optional
   │                Claude key or rule-based; separate from this app's LLM)
   └── (Has its own JSON-file admin system at /admin/ — left alone this session)
```

---

## Local verification checklist

1. Both servers boot:
   - `cd autoseo-app && npm start` → "AutoSEO running → http://localhost:3000"
   - `cd autoseo-web && npm run dev` → "Local: http://localhost:3001"
2. Open <http://localhost:3001>. The hero renders; below it the agent grid
   shows 3 live (SEO/GEO/Coding) + 6 coming-soon cards.
3. Enter a URL → onboarding spinner → redirected to `/dashboard?company=…`.
   In Supabase, confirm one new row each in `companies` and `documents` (×2)
   and at least one `proposals` row.
4. Dashboard renders four panels. The audit summary card shows score/grade.
5. Click **Run SEO + GEO audit**. New proposals appear in the feed grouped
   under SEO + GEO. Approve/Reject flips status (verify in Supabase or click
   the *Archived* tab).
6. Chat panel: ask "What should I ship first?" → the LLM responds, citing the
   current audit score.

### Failure modes (intentional)

- Supabase env missing → landing shows the "Connect Supabase" hint; dashboard
  shows the "not configured" message. No crash.
- Node engine offline → onboarding still succeeds (with hostname-derived
  defaults), and a "Audit engine offline" card seeds the feed.
- `GEMINI_API_KEY` missing → onboarding uses fallback name/description; chat
  returns a 500 with a clear "GEMINI_API_KEY missing" error.
- Wrong `AUTOSEO_MODEL` slug → Gemini returns a 4xx; the chat UI surfaces
  the upstream error message. Update the env var, no restart needed for
  `npm run dev` (it picks up changes on next request).

---

## Autonomy — the scheduler

The scheduler is the autonomous half of AutoSEO: the same agents that the
manual "Run SEO + GEO audit" button triggers, fired automatically on a
configurable interval, dropping their output into the Actions Feed as
`pending` proposals. **Nothing auto-approves or auto-publishes** — every
agent output still waits for your Approve/Reject click.

### Migration

Before first use, run `supabase/migrations/0002_scheduler.sql` in your
Supabase SQL editor. It adds `agents.schedule_hours` (default 24) and
`agent_runs.proposals_created`. Safe to re-run.

### Two entry points, one library

| Endpoint | Auth | Respects schedule? | Used by |
|---|---|---|---|
| `POST /api/scheduler/run` | `x-scheduler-secret` header | **Yes** (only runs agents whose `schedule_hours` has elapsed) | Cron — Vercel Cron, Cloud Scheduler, crontab |
| `POST /api/scheduler/run-now` | Same-origin only (no secret) | **No** (always runs every live agent) | The "Run all agents now" dashboard button |

Both call the same `runAllDue()` library function. The asymmetry is
deliberate: a cron firing every minute should only do work when there is
work; a user clicking a button is signalling "I want results now."

### "Due" logic

For each company × live+enabled agent, the scheduler picks the latest
successful `agent_runs` row (status='done'). The agent is due if no
successful run exists or the last one is older than `schedule_hours`.
A stuck `running` row does NOT suppress retries (so a crash mid-run can't
deadlock the agent forever).

Agents that share an underlying engine (SEO + GEO both run from one Node
audit) are grouped and the engine is called once; both agents still get
their own `agent_runs` row with the proposal count attributed correctly.

### Local timer

Set `ENABLE_LOCAL_SCHEDULER=true` (with optional
`LOCAL_SCHEDULER_INTERVAL_MINUTES=15`) and the in-process timer in
`lib/scheduler/local.ts` will check every interval. Started by Next's
`instrumentation.ts` hook at server boot; re-entry-guarded so a slow tick
doesn't overlap a fast one; gated again on the env flag so it never runs
when you don't ask for it.

This works only while the Next process is up. For real 24/7 autonomy you
need a deployment that always has a process (a small VM with the same env
flag set) **or** a serverless deploy + external cron (see below).

### Test it (the curl recipe)

```powershell
# 1. Run the migration. Set SCHEDULER_SECRET in .env.local (any random string).
# 2. Boot autoseo-app and autoseo-web.

# 3. With secret (cron path, respects dueness):
curl -X POST -H "x-scheduler-secret: $env:SCHEDULER_SECRET" `
  http://localhost:3001/api/scheduler/run
# Expect on first call:  {"companies": N, "agentsRun": M, "proposalsCreated": …}
# Expect on second call: {"companies": N, "agentsRun": 0, "proposalsCreated": 0, …}
#   (nothing is due yet because the first call just ran them)

# 4. Without the secret → 401:
curl -X POST http://localhost:3001/api/scheduler/run        # → 401 Unauthorized

# 5. In the dashboard: click "Run all agents now" — the Activity section at
#    the bottom should grow new rows (done · proposals count), and the
#    Actions Feed should show fresh pending items.
```

---

## Blog Agent

The first agent built on the shared agentic-loop skeleton at `lib/agents/`.
Drafts ranking-targeted articles in your brand voice and drops them in the
Actions Feed as `pending` `blog_post` proposals. **Nothing publishes without
your click.**

### Migration

Run `supabase/migrations/0003_blog_agent.sql` once. It adds the `blog` row to
the agent catalog (weekly cadence — `schedule_hours=168`), extends the
proposal status enum to include `published` / `publish_failed`, adds
`publish_url` + `publish_error` columns, and creates `agent_logs` (per-step
agentic-loop trace, scoped to a single `agent_runs` row).

### How the loop works

The Blog agent uses the shared runner in `lib/agents/runner.ts` — a generic
Gemini tool-calling loop that exposes a typed `tools/` registry to the LLM.
For each tool call the runner logs a row to `agent_logs` so you can read back
*why* the agent picked the topic it did. Step budget: 6.

Tools the Blog agent gets:

| Tool | Purpose |
|---|---|
| `get_company_context` | Reads the company + brand_voice + product_info documents. |
| `get_keyword_gaps` | Mines existing SEO/GEO audit proposals for topics worth writing about. Empty when no audit data exists — the agent then brainstorms from the company context. |
| `web_search` | Optional Tavily-backed search. Returns `{ available: false }` when `TAVILY_API_KEY` is unset, and the agent proceeds without external research. |
| `seo_self_check` | Deterministic checklist (keyword in title/H1/first 100 words, meta 140-160c, ≥3 H2s, 800-1500 words). |
| `submit_article` | Terminal — calling it ends the loop and the runner shapes the deliverable into a `blog_post` proposal. |

### Multi-platform publishing (Shopify + WordPress + manual)

The approval handler dispatches a `blog_post` approval to the right connector
by the company's detected `platform`:

| `companies.platform` | Connector | What happens on Approve |
|---|---|---|
| `shopify` | `lib/connectors/cms.ts` → Shopify Admin REST API 2026-01 | Article published live, `status='published'`, `publish_url` set |
| `wordpress` | `lib/connectors/wordpress.ts` → WP REST API + Application Passwords | Post published live, same status/URL fields |
| `unknown` | none — **manual mode** | `status='approved'` with no `publish_url`. UI shows "Copy markdown" + "Copy HTML" |

Adding a Webflow/Ghost connector later = one file + one line in `lib/connectors/index.ts`.

**Platform detection happens at onboarding.** `lib/connectors/detect.ts`:

1. Probes `{origin}/wp-json/` — a 200 + JSON manifest is the definitive WP signal.
2. Otherwise GETs the homepage and substring-scans for Shopify markers
   (`cdn.shopify.com`, `.myshopify.com`, `Shopify.shop`, `window.Shopify`),
   plus a fallback HTML-markers check for WP (`wp-content`, `wp-includes`,
   `<meta generator="WordPress …">`).
3. Otherwise `'unknown'`.

5-second budget across both probes. Any failure → `'unknown'`, never blocks
onboarding. Detection hints land in `companies.platform_meta` for debugging.

**Connector endpoints (verified against current docs):**

```
Shopify    POST /admin/api/2026-01/blogs/{blog_id}/articles.json
           Header  X-Shopify-Access-Token: <token>
           Body    { article: { title, body_html, ... } }

WordPress  POST {site}/wp-json/wp/v2/posts
           Header  Authorization: Basic base64(username:app_password)
           Body    { title, content, status: "publish", slug, excerpt }
```

Both throw the same shared error types (`CmsNotConfiguredError`,
`CmsPublishError`) so the approval handler catches once.

On Shopify success/failure the proposal moves to `published` / `publish_failed`
with `publish_error` populated; the dashboard surfaces a **Retry publish**
button that re-POSTs the same approval (useful after fixing env vars).

The blog agent never calls these connectors directly — only the approval
handler does. **One enforcement point for the human gate.**

### Env

Add to `.env.local`:

```env
# Shopify
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_TOKEN=shpat_…
SHOPIFY_BLOG_ID=                # optional

# WordPress (Users → Edit User → Application Passwords)
WORDPRESS_SITE_URL=https://example.com
WORDPRESS_USERNAME=
WORDPRESS_APP_PASSWORD=

# Optional — better freshness in blog drafts if set
TAVILY_API_KEY=
```

> **Multi-tenant note:** for now both connectors read from process env, so the
> running instance publishes to one Shopify store + one WordPress site at
> most. The proper multi-tenant version stores credentials per company —
> `getPublisher` will read from the company row instead. That's a separate
> session; the platform column already exists for it.

### Test it end-to-end

```powershell
# 1. Run the 0003 migration in Supabase SQL editor.
# 2. Restart `npm run dev`.

# 3. Trigger the blog agent. Two ways:
#    a) Wait for the scheduler (weekly), OR
#    b) Click "Run all agents now" in the dashboard header — bypasses dueness.

# 4. A `blog_post` proposal appears in the Actions Feed under "Blog Agent".
#    Click "Preview draft ▾" — title, slug, meta, body excerpt, self-check
#    metrics, internal-link suggestions.

# 5. Approve. Outcome depends on the company's detected platform:
#    platform=shopify, creds set    → status='published', "View live →" link
#    platform=shopify, no creds     → status='publish_failed', clear banner + "Retry publish"
#    platform=wordpress, creds set  → status='published', "View live →" link
#    platform=wordpress, no creds   → status='publish_failed' + "Retry publish"
#    platform=unknown               → status='approved', "Copy markdown" / "Copy HTML" buttons
#                                     (no publish call — user pastes into their site)

# 6. Inspect the agent's reasoning in Supabase:
#    select role, step, content -> 'name' as tool, created_at
#      from agent_logs
#     where run_id = '<the run id from the Activity section>'
#     order by step;
```

### What ISN'T this session (per master plan)

- LinkedIn / SEO-fix / GEO-fix / Competitor agents — separate sessions on
  the same skeleton.
- Generic-webhook / Webflow / WordPress CMS — Shopify only here.
- Internal-link injection at publish time (currently surfaced as a
  suggestion list in the proposal payload, but not auto-applied to body_html).
- Auto-publish without approval — by design, never.

---

### Deploying for true 24/7 (later session)

Pick one:

- **Vercel Cron** — add a `vercel.json` with a `crons` entry pointing at
  `/api/scheduler/run` and store `SCHEDULER_SECRET` as a Vercel env. Vercel
  cron requests must carry the header — easiest is a tiny wrapper route or
  use Vercel's secret-headers config.
- **External crontab** — any cron service that can POST with custom headers
  (cron-job.org, Cloud Scheduler) pointed at the public URL with the
  secret header.
- **Always-on VM** — set `ENABLE_LOCAL_SCHEDULER=true` and run
  `next start` under PM2 / systemd. The local timer handles the rest.

The current code is ready for any of these — the endpoint is the only
contract. Picking + wiring one is a separate session.

---

## Skills (vendored marketing frameworks)

The Blog Agent and the Coding Agent's SEO/GEO synthesis path append a curated
set of marketing-skills markdown files to their system prompts at runtime.
The skills are vendored at the repo root in `../skills/` (MIT-licensed, from
[coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)).
See `../skills/README.md` for the full attribution and update protocol.

Which agent loads which skills:

| Agent                      | Skills loaded                                                     |
|----------------------------|-------------------------------------------------------------------|
| Blog Agent                 | `copywriting`, `content-strategy`, `seo-audit`, `ai-seo`          |
| Coding Agent (SEO/GEO LLM) | `seo-audit`, `ai-seo`, `schema`, `site-architecture`              |
| Coding Agent (blog handoff)| _none_ (deterministic markdown PR, no system prompt to enrich)    |

Skills are CONTEXT, not rules — the agent's explicit operational prompt
(brand voice, step order, hard rules) remains primary. The skill block is
appended under a `## Reference frameworks` heading.

**Cost.** Loaded skills add ~10–12k tokens of system prompt per agent run.
`lib/agents/skills.ts` caps any single skill body at ~12,000 characters
(truncates at a heading boundary) and caches reads at the module level so
each skill is loaded from disk at most once per Node process.

**Toggle.** Set `SKILLS_ENABLED=false` in `.env.local` to disable. Useful for
A/B comparing output quality with vs. without the framework context.

---

## Type-check

```powershell
npm run typecheck
```
