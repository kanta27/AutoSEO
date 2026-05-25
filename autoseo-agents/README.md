# autoseo-agents — autonomous SEO + GEO multi-agent system

A LangGraph-orchestrated swarm of four specialist agents that research, audit,
strategize, and monitor SEO + Local SEO (Geo) for any brand, on live DataForSEO
data. Runs end-to-end from one command for a brand-new target.

This is the **autonomous background orchestrator** counterpart to the on-demand
Node auditor in `../autoseo-app/`. It implements the agent roster from
`../autoseo_autogeo.md` (§3) in Python.

## Architecture

```
   Research ──▶ Audit ──▶ Strategy ──▶ Monitor ──┐
   (Labs/SERP) (OnPage/   (Claude     (SERP rank  │ loop while pages
               Maps/GBP)   briefs)     tracking)  │ regressed & iter<max
        ▲                                          │
        └──────────────────────────────────────────┘ else END
```

| # | Agent | Objective | DataForSEO endpoints |
|---|-------|-----------|----------------------|
| 1 | **Research & Competitor Analyst** | Low-hanging fruit, high-volume terms, competitor keyword gaps | Labs: keyword_ideas, competitors_domain, ranked_keywords |
| 2 | **Technical & Geo Auditor** | On-page defects + local/map optimization opportunities | On-Page instant_pages, SERP Maps, Business Data listings |
| 3 | **Content Strategy & Brief Generator** | Semantic content briefs, internal-linking plan, geo landing-page outlines | — (consumes 1 & 2; uses Claude) |
| 4 | **Performance & Monitoring Agent** | Daily rank movements; flags pages to re-optimize | SERP Google Organic |

State is a single typed `SEOState` dict (`state.py`); each agent returns a partial
update that LangGraph merges. The loop is **sequential but iterative**: Monitor's
`needs_reoptimization` flag (a rank drop ≥ 3 or a fall out of top-10) routes the
graph back to Research until `--max-iterations` is reached.

## File structure

```
autoseo-agents/
├── main.py                       # CLI entrypoint
├── requirements.txt
├── .env.example
├── targets/example.json          # sample brand target
└── autoseo_agents/
    ├── config.py                 # env-driven settings (.env)
    ├── state.py                  # SEOState + BrandTarget (typed shared state)
    ├── dataforseo/               # async API integration layer
    │   ├── client.py             # auth, retry/backoff, concurrency cap, budget guard
    │   ├── labs.py               # keyword ideas / competitors / ranked keywords
    │   ├── serp.py               # Google Organic + Google Maps
    │   ├── onpage.py             # instant single-page technical audit
    │   └── business.py           # Google Business Profile listings
    ├── agents/                   # the 4 agents (graph nodes) + LLM helper
    │   ├── base.py  research.py  audit.py  strategy.py  monitor.py
    └── orchestration/
        └── graph.py              # LangGraph StateGraph + iterative loop
```

Generated at runtime: `caches/` (rank history, persisted between runs) and
`reports/<domain>.json` (full state dump).

## Setup

```powershell
cd autoseo-agents
py -m venv .venv
.\.venv\Scripts\Activate.ps1          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env                # then edit .env with your credentials
```

Required in `.env`: `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` (from
<https://app.dataforseo.com/api-access>). `ANTHROPIC_API_KEY` is optional — without
it the agents run on DataForSEO data with deterministic fallbacks (no AI briefs).

## Run it for a brand-new target

Inline flags:

```powershell
py main.py `
  --domain acme-plumbing.com `
  --brand "Acme Plumbing" `
  --location "Austin,Texas,United States" `
  --location-code 2840 `
  --keywords "emergency plumber,water heater repair,drain cleaning" `
  --max-iterations 2 `
  --verbose
```

Or from a JSON target file:

```powershell
py main.py --target targets/example.json --max-iterations 2 -v
```

What happens:
1. **Research** expands seeds → keyword ideas, auto-discovers competitors (if none
   given), and computes gaps vs. the brand's own ranked keywords.
2. **Audit** runs an instant on-page audit, checks the local pack for the primary
   geo query, and pulls the brand's GBP listing.
3. **Strategy** (Claude) emits structured content briefs, internal links, and
   geo landing-page outlines.
4. **Monitor** checks live organic positions for the tracked keywords, diffs them
   against `caches/rankings_<domain>.json`, and flags drops.
5. If anything regressed and iterations remain, the graph **loops** back to
   Research; otherwise it prints a summary and writes `reports/<domain>.json`.

`--max-iterations 1` (default) is a single clean pass with no loop.

## Operational notes

- **Budget guard**: the client hard-stops once accumulated DataForSEO cost crosses
  `DATAFORSEO_DAILY_BUDGET` (default $5), raising `BudgetExceededError`.
- **Resilience**: 429/5xx and timeouts retry with exponential backoff (tenacity);
  concurrency is capped by `DATAFORSEO_MAX_CONCURRENCY`.
- **Scheduling**: to run autonomously (the spec's nightly cadence), invoke
  `main.py` from cron / Task Scheduler. Rank history persists in `caches/`, so each
  run measures movement against the last.
- **Costs**: `keyword_ideas`, `ranked_keywords`, and per-keyword SERP calls dominate
  spend. Lower `--keywords`, the Labs `limit`s, or the tracked-keyword cap in
  `monitor.py` to control it.
