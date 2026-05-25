# Autonomous SEO + GEO Agent System — Research & Spec

_Saved: 2026-04-23. Context for building a background-autonomous SEO/GEO agent platform that continuously audits, fixes, and self-improves. Targets integration with a NanoClaw-style harness (Docker-per-session, MCP tools, per-user/group volumes) and DataForSEO APIs as the primary data layer._

---

## 1. Research findings (last 30 days, synthesized)

### 1.1 Architecture convergence
The field has converged on one architecture — four-agent audit pipelines (**Crawler → Diagnostician → Prioritizer → Implementer**), rules-engine first (80% deterministic), LLM only for the ambiguous remainder, ending in a PR.

Named examples:
- **Digital Applied** — 4-agent crawl-to-PR pipeline; 40-hour engagement compressed to a 45-minute background job.
- **SEOLint** (Claude plugin) — connects a GitHub repo; agent opens a PR with the fix, waits for CI green, hands to human for review. Mechanical fixes first: meta, alt, canonical, schema, sitemap.
- **Otto AI** — autonomous technical audits + content updates + on-page improvements at scale.
- **Frase Content Watchdog** — operates at "Level 3": what's wrong, why it happened, and the fix ready to apply.
- **SEObot, seosapient, Stormy, Lyzr, RhinoAgents** — similar multi-agent shapes.

### 1.2 GEO is now roughly co-equal with SEO
- **AI Overviews**: ~48% query coverage by March 2026 (up from 34.5% in Dec 2025).
- **Google AI Mode**: ~75M DAU; ~93% of sessions end **zero-click**.
- Dedicated tracking platforms measure **share of citations** across ChatGPT / Perplexity / Gemini / AI Overviews.
- **Key optimization stat**: 44.2% of LLM citations come from the **first 30%** of text → front-load answers, TL;DRs, citable statistics.
- **Leading GEO platforms (2026)**: Profound, Peec AI, Scrunch, Adobe LLM Optimizer, AthenaHQ, Bluefish, Semrush AI Visibility Toolkit, Otterly.AI, LLMrefs, LLM Pulse, HubSpot AEO, Visiblie, Gauge, Evertune, tryprofound.

### 1.3 Rank-drop → auto-fix loops are the signature capability
Pattern:
1. Detect drop (position Δ ≥ 3 or SERP-feature loss).
2. Analyze competitors (who ranks now, with what content).
3. Rewrite (content + meta + schema).
4. Resubmit (IndexNow / GSC ping).
5. Monitor in < 24h.

Success rates reported in the field:
- Simple meta rewrites: **85–90%** success.
- Complex content restructures: **65–75%** success.
- One documented run: meta rewrites across 10,000+ pages in < 24h → **~18% average CTR lift**.

### 1.4 Backlink agents in production
- Send **10–20 personalized outreaches/day**.
- **5–10% reply/conversion** → 3–6 new backlinks/week hands-off.
- Prospect discovery: backlink-gap vs competitors (Ahrefs/DataForSEO), unlinked brand mentions.
- Personalization: reference prospect's recent content + specific topical fit.
- Named examples: LobsterLair (OpenClaw agent), SEObot, Agents24x7, GeekyTech, Serplux.

### 1.5 Existing skill packs worth reading before building
- `aaron-he-zhu/seo-geo-claude-skills` — 20 SEO & GEO skills (CORE-EEAT + CITE frameworks).
- `AgriciDaniel/claude-seo` — 19 sub-skills, 12 subagents, 3 extensions (DataForSEO, Firecrawl, Banana).
- `seo-skills/seo-audit-skill` — 108 audit rules across 12 categories.
- `JeffLi1993/seo-audit-skill` — beginner + advanced technical reports.
- `TheCraigHewitt/seomachine` — long-form SEO content workspace.
- `SearchFit SEO` — Anthropic plugin.

### 1.6 Key external integrations the field uses
- **Google Search Console API** — real CTR, indexing, AI-Overview query data.
- **Google Analytics** — traffic, conversions for impact scoring.
- **CMS APIs** — WordPress, Webflow, Shopify, Ghost, Sanity.
- **GitHub API** — PR-based fixes.
- **Firecrawl / Playwright** — real-browser crawl for JS-heavy sites.
- **IndexNow / GSC URL Inspection** — re-indexing.
- **SMTP / Gmail API** — outreach.
- **Vector DB (pgvector / sqlite-vec)** — semantic internal linking.

---

## 2. DataForSEO APIs and where each plugs in

| Family | Notable endpoints | Unit pricing (reference) |
|---|---|---|
| **SERP** | Google Organic Live (regular/advanced), Images, News, Maps, Bing, YouTube | $0.0006–$0.002 / req |
| **AI Optimization** | LLM Mentions, LLM Responses, LLM Scraper, Keyword Volume | per pricing page |
| **Keywords Data** | Google Ads Search Volume, Keywords For Site, Trends, Clickstream | — |
| **DataForSEO Labs** | Domain Intersection (gap analysis), Ranked Keywords, Competitors Domain, Keyword Ideas, Related Keywords, Relevant Pages, Keyword Difficulty | Live: ~$0.0001/row + $0.01/task |
| **Backlinks** | Summary, Backlinks, Referring Domains, Anchors, History, New/Lost | $0.02/task + $0.00003/row; $100/mo min |
| **OnPage** | Task POST, Pages, Resources, Links, Duplicate Tags, Parsed Content, Redirect Chains, Non-Indexable, Lighthouse | $0.000125–$0.00425 / page |
| **Content Analysis** | Search, Summary, Sentiment, Phrase Trends | $0.02/task + $0.00003/row |
| **Business Data** | Google Reviews, Google Business Info, Trustpilot, Hotels, Q&A | $0.0015–$0.003/task |
| **Domain Analytics** | Technologies, Whois | $0–$0.001/row, $0.01/task |
| **Merchant / App Data / Social Media** | (skip unless e-commerce / app-store / community-signal need emerges) | — |

---

## 3. Agent roster

### 3.1 Audit swarm (read-only, idempotent, cacheable)

| # | Agent | Detects | DataForSEO | Other inputs | Cadence |
|---|---|---|---|---|---|
| A1 | **Crawler** | URLs, status codes, HTML snapshots, Core Web Vitals | OnPage (Task POST + Pages + Resources + Lighthouse) | Sitemap, GSC URL list | Nightly full, hourly delta |
| A2 | **Tech Auditor** | robots.txt, canonicals, hreflang, redirect chains, 404s, orphans, sitemap health | OnPage (parsed_content, redirect_chains, non_indexable) | — | Per Crawler run |
| A3 | **On-Page Auditor** | Title/meta/H1 issues, thin content, bad alts, internal-link gaps | OnPage (pages, duplicate_tags, links) | — | Per Crawler run |
| A4 | **Schema Auditor** | Missing/invalid JSON-LD, content↔schema mismatch, rich-result eligibility | OnPage (parsed_content microdata) | Google Rich Results Test | Per Crawler run |
| A5 | **Rank Tracker** | Position changes, SERP-feature wins/losses, AI-Overview presence | SERP API Google Organic Live (advanced) | — | Daily |
| A6 | **Keyword-Gap Auditor** | Competitor keywords we don't rank for; abandoned clusters | Labs — Domain Intersection, Ranked Keywords, Competitors Domain, Relevant Pages | — | Weekly |
| A7 | **Content-Quality Auditor** | Topical gaps, semantic thinness, outdated stats, duplicate intent | Labs (Related Keywords, Keyword Ideas), Content Analysis (Search, Summary) | Internal vector index | Weekly |
| A8 | **Backlink Auditor** | New/lost links, toxic domains, anchor skew, velocity vs competitors | Backlinks API (Summary, Backlinks, Referring Domains, Anchors, History) | — | Daily delta, weekly full |
| A9 | **SERP-Feature Auditor** | Which features SERP exposes (PAA, FAQ, image, video, AI Overview) | SERP API advanced | — | Daily |
| A10 | **GEO / LLM-Visibility Auditor** | Citation share across ChatGPT/Perplexity/Gemini/AI Overview; which pages get cited; competitor mention share | AI Optimization — LLM Mentions, LLM Responses, Keyword Volume | Optional: Profound/Peec/Otterly cross-verification | Daily |
| A11 | **Brand-Mention Auditor** | External mentions, sentiment, unlinked mentions | Content Analysis (Search + Sentiment), Domain Analytics Whois | — | Daily |
| A12 | **Local / Business Auditor** | GBP listings, review velocity, competitor reviews | Business Data — Google Reviews, Google Business Info | — | Daily |
| A13 | **Tech-Stack Auditor** | Competitor/prospect tech stack (CMS, CDN, analytics) | Domain Analytics — Technologies | — | Weekly |
| A14 | **Log Auditor** | Real Googlebot/Bingbot behavior — crawl waste, unvisited priority URLs | Raw server logs / Cloudflare Logpush | — | Daily |

### 3.2 Solver swarm (write, always gated, always via PR)

| # | Agent | Action | Reads | Produces | Gate |
|---|---|---|---|---|---|
| S1 | **Meta Rewriter** | Rewrites titles/descriptions where CTR < 2% at position 4–10 | A3, GSC CTR, A9 | Git PR diff | `acceptEdits` staging / human gate prod |
| S2 | **Schema Injector** | Emits JSON-LD (FAQ, HowTo, Product, Article) | A4, A3 | Git PR diff | `auto` |
| S3 | **Internal-Linker** | Adds in-body links between related pages; fixes orphans | A2, A7 + vector index | Git PR diff | `auto` |
| S4 | **Canonical / Redirect Fixer** | Collapses redirect chains, fixes canonical mismatches | A2 | Git PR diff | `auto` |
| S5 | **Content Refresher** | Updates outdated pages; new stats, re-dates, expands thin sections | A7, A5, SERP | Git PR diff + CMS draft | Human gate |
| S6 | **Content Writer (Brief → Draft)** | Generates briefs from gaps, then drafts | A6, A7, SERP top-10 + PAA + competitor H-tags | CMS draft | Human gate |
| S7 | **GEO Optimizer** | Front-loads answer in first 30%; adds TL;DR, quotable stats, citable claims, Q&A blocks | A10, A7 | Git PR diff | `auto` low-risk, gate hero pages |
| S8 | **Image / CWV Fixer** | Compress, add dimensions, lazy-load, inline critical CSS | A1 Lighthouse | Git PR diff | `auto` |
| S9 | **Backlink Outreach Agent** | Prospects via gap + unlinked mentions, personalizes, sends 10–20/day, follows up | A8, A7, A11 | Emails via SMTP | `auto` with per-day cap + domain blocklist + reply kill-switch |
| S10 | **Broken-Link Healer** | Inbound dead links → redirect map; outbound 404s → replacement | A2, A8 | Git PR diff + 301 rules | `auto` |
| S11 | **PR Router** | Bundles diffs from S1–S8 thematically, opens one PR/theme with evidence + before/after | all solvers | GitHub PRs | — |
| S12 | **Resubmit Agent** | On deploy, pings GSC + Bing Webmaster + IndexNow | — | API pings | `auto` |

### 3.3 Orchestration layer

| Component | Role |
|---|---|
| **Planner** | On wake, reads latest audit snapshot + queue, decides which solvers fire this cycle |
| **Prioritizer** | Scores findings: `impact = traffic_at_risk × conversion_rate`, `confidence = 1 - ambiguity`, `effort = est. lines changed`. Top-N into queue |
| **Scheduler** | Cron-like via host DB (NanoClaw pattern). Pre-flight `wakeAgent` diff before spinning LLM |
| **Budget Controller** | Per-day $ caps per DataForSEO family; hard-stop + Slack alert on breach |
| **PR Bundler** | One PR/theme/week unless severity ≥ P1 |
| **Memory Writer** | Every fix, rank move, citation change → typed memory (`feedback` / `project` / `reference`) with `Why:` + `How to apply:` lines |

---

## 4. Triggers and self-improvement loops

1. **Rank-drop loop** (Level-3 pattern):
   A5 detects Δ ≥ 3 or feature loss → fires A3 + A6 on URL → Prioritizer marks P1 → S5/S7 drafts fix → S11 opens PR w/ before/after from A9 → S12 pings re-crawl → A5 re-checks 24h → outcome written to memory.
2. **Citation-loss loop (GEO)**:
   A10 detects citation-share drop → A7 finds competing cited page → S7 front-loads our answer + adds missing stat → PR → monitor.
3. **Keyword-gap loop**:
   A6 weekly finds "competitor ranks, we don't" in clusters with topical authority → S6 brief+draft → human approves → publish → S3 wires internal links.
4. **Backlink outreach loop**:
   A8 + A11 find unlinked brand mentions + competitor backlinks on reachable domains → S9 pitches → replies classified by a thread-auth sub-agent → memory of who responded and which template worked.
5. **Skill-promotion loop** (NanoClaw use-case monitor):
   Watch which solvers fire most and which prompts get corrected → repeated patterns become new skills, repeated corrections become memory entries.
6. **Outcome-weighted prompt evolution**:
   Every S1 rewrite A/B-logged vs GSC CTR. Winning meta patterns feed back into S1 system prompt monthly. Same for S7 (front-loading templates) and S6 (brief templates).

---

## 5. Data layer

Each cache = own SQLite DB, opened `?immutable=1` by readers (NanoClaw pattern):

```
caches/
  pages.db         (A1/A3/A4) — FTS5 on body, H-tags, meta
  rankings.db      (A5)        — keyword × URL × date × position
  keywords.db      (A6/A7)     — Labs output + own/competitor sets
  backlinks.db     (A8)        — Backlinks API rows
  serp_features.db (A9)        — per-query feature presence
  llm_citations.db (A10)       — query × LLM × cited URL × position
  mentions.db      (A11)       — Content Analysis rows, FTS5 on snippet
  business.db      (A12)       — reviews, listings
  tech_stack.db    (A13)       — per-domain tech rows
  logs.db          (A14)       — bot hits
  outreach.db      (S9)        — prospects, sent, replied, outcome
  prs.db           (S11)       — fix history linked to audits
  memory/          (typed .md + index) — NanoClaw-style
```

Unified search across all caches (BM25 + per-source weights) is the default retrieval tool. Karpathy-wiki compilation nightly produces per-URL and per-keyword-cluster profiles.

---

## 6. Permission & safety (NanoClaw parity)

- **Egress allowlist**: `api.dataforseo.com`, `searchconsole.googleapis.com`, `api.github.com`, CMS host, SMTP host. One config-reload MCP tool; nothing silent.
- **Secrets**: DataForSEO, GSC, GitHub, SMTP — all in Google Secret Manager, injected at session start.
- **Solver gating**:
  - `auto`: S2, S3, S4, S8, S10, S12.
  - `acceptEdits`: S1, S7.
  - Human gate: S5, S6, and any S9 domain-list change.
- **Budget controller** enforces per-day $ caps per DataForSEO family in the harness, not in the prompt.
- **Outreach (S9)** has hard-coded daily send cap + domain blocklist file + "reply detected" kill-switch.

---

## 7. MVP build order (2 weeks)

**Week 1 — Audit-only, zero writes**
1. A1 Crawler + A3 On-Page + A5 Rank Tracker → caches + unified search → Slack `/seo-status <url>` skill.
2. A10 GEO Auditor in parallel — highest differentiation, little prior art to clone.

**Week 2 — First solver loop**
3. S11 PR Router + S1 Meta Rewriter + S2 Schema Injector — highest fix/effort ratio.
4. Rank-drop trigger (A5 → Prioritizer → S1/S7 → S11) end-to-end on one staging site.

Everything else layers on the same primitives.

---

## 8. Sources

- Digital Applied — Agentic SEO Audit Automation: https://www.digitalapplied.com/blog/agentic-seo-audit-automation-crawl-to-implementation
- SEOLint: https://seolint.dev
- Frase — AI Agents for SEO (2026) & Content Watchdog: https://www.frase.io/blog/ai-agents-for-seo
- Visiblie — 9 Best AI Visibility Tools 2026: https://www.visiblie.com/blog/best-ai-visibility-tools
- Scrunch — 7 best AEO/GEO tools 2026: https://scrunch.com/blog/best-answer-engine-optimization-aeo-generative-engine-optimization-geo-tools-2026
- LLMrefs — Generative Engine Optimization: https://llmrefs.com/generative-engine-optimization
- LobsterLair — Autonomous SEO with OpenClaw: https://lobsterlair.xyz/blog/autonomous-seo-openclaw
- Agents24x7 — Automate Backlink Outreach: https://agents24x7.com/blog/automate-backlink-outreach-shopify-wordpress
- aaron-he-zhu/seo-geo-claude-skills: https://github.com/aaron-he-zhu/seo-geo-claude-skills
- AgriciDaniel/claude-seo: https://github.com/AgriciDaniel/claude-seo
- seo-skills/seo-audit-skill: https://github.com/seo-skills/seo-audit-skill
- Evertune — Top 15 GEO Platforms 2026: https://www.evertune.ai/resources/insights-on-ai/top-15-generative-engine-optimization-geo-platforms-for-2026
- DataForSEO — Uncover keyword gaps: https://dataforseo.com/help-center/uncover-keyword-gaps-with-dataforseo-api
- DataForSEO Labs — Competitors Domain endpoint: https://docs.dataforseo.com/v3/dataforseo_labs-google-competitors_domain-live/
- DataForSEO pricing list: https://dataforseo.com/pricing-list
- Source Notion design doc: https://bitsafe.notion.site/Building-a-Company-Wide-AI-Assistant-Architecture-Security-and-Self-Improvement-34b636dd0ba5811e8299c4e2d37d2b28
