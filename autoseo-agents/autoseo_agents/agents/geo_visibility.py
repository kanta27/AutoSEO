"""Agent A10 — GEO / LLM-Visibility Auditor.

Per spec §3.1 row A10 and §4 loop #2 (Citation-loss loop), this is the highest-
differentiation capability in the swarm: measure whether AI engines (ChatGPT /
Perplexity / Gemini / Google AI Overviews) cite the brand for tracked queries,
who gets cited instead, and what citable gaps competitors are exploiting.

Three execution paths, in preference order — the pipeline always completes:

1. **DataForSEO AI Optimization** — preferred. Real citation data per query.
2. **LLM-estimated assessment** — when AI Optimization isn't available, ask
   Claude to score GEO-readiness from the on-page snapshot + competitor data
   already in state. Same `reason_structured` pattern as `strategy.py`.
3. **Deterministic skeleton** — when neither LLM nor DataForSEO is configured.
   Treat every tracked query as uncited; readiness=50. Same shape as
   `strategy._fallback_plan`.
"""
from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field

from autoseo_agents.agents._tracked import tracked_keywords
from autoseo_agents.agents.base import reason_structured
from autoseo_agents.config import settings
from autoseo_agents.dataforseo import DataForSEOClient, DataForSEOError
from autoseo_agents.dataforseo import ai_optimization
from autoseo_agents.state import SEOState

log = logging.getLogger("autoseo.agents.geo_visibility")

# Per-query LLM-engine fan-out can blow the default $5 DataForSEO budget on a
# 15-keyword run. Cap the AI-Optimization path; the LLM-fallback scores all
# tracked keywords regardless because it costs ~one Claude call total.
AI_OPT_QUERY_CAP = 8
# Below this score, set needs_reoptimization so the loop can re-fire on GEO
# weakness (not just SERP drops). 0..100, mirrors on-page score convention.
GEO_READINESS_THRESHOLD = 60
# Fraction of tracked queries the brand is uncited on that escalates to a
# loop trigger even when the readiness score itself looks fine.
UNCITED_REOPT_FRACTION = 0.5


SYSTEM = """You are the GEO / LLM-Visibility Auditor for an autonomous SEO
system. Your job is to assess whether AI engines (ChatGPT, Perplexity, Gemini,
Google AI Overviews) would cite this brand when users ask the tracked queries.

Score GEO-readiness 0-100 based on the four signals proven to drive LLM
citations (per recent research: ~44% of citations come from the first 30% of
the page text):

  1. Answer front-loading — is the direct answer in the first 30% of body text?
  2. Quotable statistics — concrete numbers/percentages LLMs can extract.
  3. Q&A structure — explicit question headings or FAQ blocks.
  4. Citable claims — declarative sentences with named entities and sources.

For each tracked query the brand is unlikely to be cited for, identify which
competitor is likely cited instead (use the competitor list provided) and what
specific citable content gap explains the loss. Be concrete; never invent
metrics. Recommendations must be actionable rewrites, not generic advice."""


class CitedQuery(BaseModel):
    query: str
    cited_url: str | None = Field(default=None, description="brand URL the LLM cites, if any")
    llm_engines: list[str] = Field(default_factory=list, description="which engines cite us")


class CitableGap(BaseModel):
    topic: str
    gap_type: str = Field(description="missing_stat | missing_qa | buried_answer | missing_entity | other")
    suggested_addition: str


class GeoVisibilityReport(BaseModel):
    cited_queries: list[CitedQuery]
    uncited_queries: list[str]
    competitor_citation_share: dict[str, float] = Field(
        description="domain -> share 0..1 of tracked queries where they're cited"
    )
    citable_gaps: list[CitableGap]
    geo_readiness_score: int = Field(ge=0, le=100)
    recommendations: list[str]


# --- data path -----------------------------------------------------------

async def _measure_via_dataforseo(
    keywords: list[str], domain: str, loc: int, lang: str
) -> tuple[dict, float] | None:
    """Returns (raw_measurements, cost) or None if the AI Optimization API
    isn't accessible. Raw shape:
        {keyword: {cited: bool, cited_url, llm_engines: [...],
                   competitors_cited: [domain, ...]}}
    """
    measurements: dict[str, dict] = {}
    try:
        async with DataForSEOClient() as client:
            for kw in keywords[:AI_OPT_QUERY_CAP]:
                mentions = await ai_optimization.llm_mentions_search(client, kw, loc, lang)
                cited = [m for m in mentions if m.get("domain") and domain in m["domain"]]
                competitors_cited = sorted({
                    m["domain"] for m in mentions
                    if m.get("domain") and domain not in m["domain"]
                })
                measurements[kw] = {
                    "cited": bool(cited),
                    "cited_url": cited[0]["url"] if cited else None,
                    "llm_engines": sorted({m["llm"] for m in cited if m.get("llm")}),
                    "competitors_cited": competitors_cited,
                }
            cost = client.total_cost
    except DataForSEOError as exc:
        log.warning("AI Optimization unavailable, falling back to LLM-only: %s", exc)
        return None
    return measurements, cost


def _measurements_to_report(measurements: dict, keywords: list[str]) -> GeoVisibilityReport:
    cited_queries: list[CitedQuery] = []
    uncited: list[str] = []
    competitor_counts: dict[str, int] = {}
    for kw in keywords:
        m = measurements.get(kw)
        if m and m["cited"]:
            cited_queries.append(CitedQuery(
                query=kw, cited_url=m["cited_url"], llm_engines=m["llm_engines"],
            ))
        else:
            uncited.append(kw)
        if m:
            for d in m["competitors_cited"]:
                competitor_counts[d] = competitor_counts.get(d, 0) + 1
    total = max(len(keywords), 1)
    share = {d: round(c / total, 3) for d, c in sorted(
        competitor_counts.items(), key=lambda kv: kv[1], reverse=True
    )[:10]}
    cited_frac = len(cited_queries) / total
    score = int(round(cited_frac * 100))
    recs = []
    if uncited:
        recs.append(
            f"Front-load direct answers for {len(uncited)} uncited queries in the "
            "first 30% of body text and add a TL;DR block at the top."
        )
    if share:
        top = next(iter(share))
        recs.append(f"Reverse-engineer what {top} provides that we don't (most-cited competitor).")
    return GeoVisibilityReport(
        cited_queries=cited_queries,
        uncited_queries=uncited,
        competitor_citation_share=share,
        citable_gaps=[],  # filled in by the LLM path when available
        geo_readiness_score=score,
        recommendations=recs or ["Maintain current GEO posture; re-check next cycle."],
    )


# --- llm-only path -------------------------------------------------------

async def _measure_via_llm(state: SEOState, keywords: list[str]) -> GeoVisibilityReport | None:
    research = state.get("research", {})
    audit = state.get("audit", {})
    target = state["target"]
    onpage = audit.get("onpage", {}) or {}

    human = (
        f"Brand: {target.get('brand_name')} ({target['domain']}).\n"
        f"Tracked queries (the brand wants AI engines to cite it for these):\n"
        f"  {keywords}\n"
        f"Known competitors (likely citation targets to evaluate share against):\n"
        f"  {research.get('competitors', [])}\n"
        f"On-page snapshot of brand homepage:\n"
        f"  word_count={onpage.get('word_count')}, "
        f"onpage_score={onpage.get('onpage_score')}, "
        f"failed_checks={onpage.get('failed_checks')}, "
        f"title={onpage.get('title')}, "
        f"meta_description={onpage.get('description')}\n"
        f"Competitor keyword gaps (what they rank for, we don't):\n"
        f"  {[g.get('keyword') for g in research.get('gaps', [])[:10]]}\n\n"
        "Produce the GEO Visibility report. For each tracked query: decide if the "
        "brand is likely cited by AI engines based on the on-page signals, list "
        "which competitor would likely be cited instead, and identify the specific "
        "citable gap. Compute competitor_citation_share as a fraction of tracked "
        "queries each competitor is likely cited on."
    )
    return await reason_structured(SYSTEM, human, GeoVisibilityReport)


# --- skeleton path -------------------------------------------------------

def _fallback_report(keywords: list[str]) -> GeoVisibilityReport:
    return GeoVisibilityReport(
        cited_queries=[],
        uncited_queries=list(keywords),
        competitor_citation_share={},
        citable_gaps=[
            CitableGap(
                topic="answer front-loading",
                gap_type="buried_answer",
                suggested_addition="Add a TL;DR block at the top of each page that directly "
                "answers the target query in <=2 sentences.",
            ),
        ],
        geo_readiness_score=50,
        recommendations=[
            "Front-load the direct answer in the first 30% of body text "
            "(spec §1.2 — 44% of LLM citations come from the first 30%).",
            "Add quotable statistics, Q&A blocks, and named-entity citations.",
        ],
    )


# --- agent ---------------------------------------------------------------

async def geo_visibility_agent(state: SEOState) -> dict:
    target = state["target"]
    loc, lang = target["location_code"], target["language_code"]
    keywords = tracked_keywords(state)
    flags: list[str] = []
    cost = 0.0

    if not keywords:
        log.info("geo_visibility: no tracked keywords — skipping")
        return {"geo_visibility": _fallback_report([]).model_dump()}

    report: GeoVisibilityReport | None = None
    source = "fallback"

    # Path 1 — DataForSEO AI Optimization (real data).
    if settings.has_dataforseo:
        result = await _measure_via_dataforseo(keywords, target["domain"], loc, lang)
        if result is not None:
            measurements, cost = result
            report = _measurements_to_report(measurements, keywords)
            source = "dataforseo"
            # Enrich `citable_gaps` with the LLM if available — DataForSEO tells
            # us *who* is cited; the LLM explains *why* and *what to add*.
            if settings.has_llm:
                enriched = await _measure_via_llm(state, keywords)
                if enriched and enriched.citable_gaps:
                    report.citable_gaps = enriched.citable_gaps

    # Path 2 — LLM-only assessment.
    if report is None and settings.has_llm:
        report = await _measure_via_llm(state, keywords)
        if report is not None:
            source = "llm"

    # Path 3 — deterministic skeleton.
    if report is None:
        report = _fallback_report(keywords)

    # Flags + loop trigger.
    tracked_total = len(keywords)
    uncited_total = len(report.uncited_queries)
    if uncited_total:
        flags.append(
            f"Brand not cited by AI for {uncited_total}/{tracked_total} tracked queries"
        )
    if report.geo_readiness_score < GEO_READINESS_THRESHOLD:
        flags.append(
            f"GEO readiness score {report.geo_readiness_score}/100 — below "
            f"threshold {GEO_READINESS_THRESHOLD}"
        )

    geo_needs_reopt = (
        report.geo_readiness_score < GEO_READINESS_THRESHOLD
        or (tracked_total > 0 and uncited_total / tracked_total > UNCITED_REOPT_FRACTION)
    )

    log.info(
        "geo_visibility[%s]: %d cited / %d tracked, score=%d, $%.4f",
        source, len(report.cited_queries), tracked_total, report.geo_readiness_score, cost,
    )

    out: dict[str, Any] = {
        "geo_visibility": report.model_dump(),
        "flags": state.get("flags", []) + flags,
        "cost_usd": state.get("cost_usd", 0.0) + cost,
    }
    # OR-in (don't clobber) so an upstream True survives a healthy GEO read.
    out["needs_reoptimization"] = bool(state.get("needs_reoptimization")) or geo_needs_reopt
    return out
