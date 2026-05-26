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
  (Kimi 2.5 via MeshAPI) to infer name/description/brand-voice/product-info,
  creates the company + documents, seeds the Actions Feed with the audit
  summary, redirects to the dashboard.
- Dashboard (`/dashboard`) — 4-panel layout pulling live from Supabase.
- `POST /api/agents/seo/run` — re-runs the SEO/GEO audit, turns each finding
  into a `proposals` row, records an `agent_runs` row.
- `POST /api/proposals/:id` — Approve/Reject (status flip only; real publish
  actions land in a later session).
- `POST /api/chat` — streamed LLM reply (SSE; Kimi 2.5 via MeshAPI) grounded
  on the live company context (company + pending proposals + latest audit +
  documents).

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
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi…             # service-role, server-only
MESHAPI_API_KEY=msh-…                              # get at https://app.meshapi.ai/
MESHAPI_BASE_URL=https://api.meshapi.ai/v1         # default; override only if MeshAPI changes
AUTOSEO_MODEL=moonshotai/Kimi-K2.5                 # exact slug from your MeshAPI dashboard
NODE_ENGINE_URL=http://localhost:3000              # autoseo-app default
```

> **About the model slug:** MeshAPI is an OpenAI-compatible gateway over 300+
> models. The Kimi 2.5 slug above matches the Hugging Face / Together AI
> convention, but if your MeshAPI dashboard shows a different identifier
> (e.g. `kimi-k2.5`, `moonshot/kimi-k2-5`), put that string here. No code
> change needed.

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
  ├── lib/llm.ts                MeshAPI client (OpenAI SDK, server-only)
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
   │                Claude key or rule-based; not yet migrated to MeshAPI)
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
- `MESHAPI_API_KEY` missing → onboarding uses fallback name/description; chat
  returns a 500 with a clear "MESHAPI_API_KEY missing" error.
- Wrong `AUTOSEO_MODEL` slug → MeshAPI returns a 4xx; the chat UI surfaces
  the upstream error message. Update the env var, no restart needed for
  `npm run dev` (it picks up changes on next request).

---

## Type-check

```powershell
npm run typecheck
```
