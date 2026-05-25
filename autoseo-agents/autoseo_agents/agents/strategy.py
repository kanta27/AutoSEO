"""Agent 3 — Content Strategy & Brief Generator.

Objective: turn Agent 1 (keywords/gaps) + Agent 2 (technical/local) findings into
structured semantic content briefs, an internal-linking plan, and geo-targeted
landing-page outlines. LLM-driven; falls back to a deterministic skeleton brief
when no API key is present.
"""
from __future__ import annotations

import logging

from pydantic import BaseModel, Field

from autoseo_agents.agents.base import reason_structured
from autoseo_agents.state import SEOState

log = logging.getLogger("autoseo.agents.strategy")

SYSTEM = """You are the Content Strategy & Brief Generator for an autonomous SEO
system. Using the keyword opportunities, competitor gaps, and technical/local
audit, produce an actionable plan:
- content_briefs: for the top opportunities, a semantic brief (target keyword,
  search intent, suggested H1, H2/H3 outline, entities/subtopics to cover, word
  count target, and the single question the page must answer in its first 30%).
- internal_links: concrete source-page -> target-page link suggestions with
  anchor text, prioritizing topical clusters.
- geo_landing_pages: for the target location, outlines for geo-targeted landing
  pages (one per high-value service + city), each with title, H1, and local
  trust signals to include (NAP, reviews, map embed, local schema).
Ground everything in the data provided; never invent metrics."""


class ContentBrief(BaseModel):
    target_keyword: str
    search_intent: str = Field(description="informational | commercial | transactional | navigational")
    suggested_h1: str
    outline: list[str] = Field(description="H2/H3 headings in order")
    entities: list[str] = Field(description="subtopics/entities to cover for semantic depth")
    word_count_target: int
    answer_first: str = Field(description="the direct answer to front-load in the first 30%")


class InternalLink(BaseModel):
    from_page: str
    to_page: str
    anchor_text: str
    reason: str


class GeoLandingPage(BaseModel):
    title: str
    h1: str
    target_query: str
    local_signals: list[str]


class StrategyPlan(BaseModel):
    content_briefs: list[ContentBrief]
    internal_links: list[InternalLink]
    geo_landing_pages: list[GeoLandingPage]
    rationale: str


def _fallback_plan(state: SEOState) -> dict:
    research = state.get("research", {})
    target = state["target"]
    city = target["location_name"].split(",")[0]
    opps = (research.get("low_hanging") or []) + (research.get("gaps") or [])
    briefs = [
        {
            "target_keyword": o["keyword"],
            "search_intent": "informational",
            "suggested_h1": o["keyword"].title(),
            "outline": ["Overview", "Key considerations", "How to choose", "FAQ"],
            "entities": [],
            "word_count_target": 1200,
            "answer_first": f"Direct answer for '{o['keyword']}'.",
        }
        for o in opps[:8]
    ]
    return {
        "content_briefs": briefs,
        "internal_links": [],
        "geo_landing_pages": [
            {
                "title": f"{(target.get('brand_name') or target['domain'])} — {kw} in {city}",
                "h1": f"{kw.title()} in {city}",
                "target_query": f"{kw} {city}",
                "local_signals": ["NAP block", "Google reviews", "Map embed", "LocalBusiness schema"],
            }
            for kw in (target.get("seed_keywords") or [])[:3]
        ],
        "rationale": "Deterministic fallback (no LLM configured).",
    }


async def strategy_agent(state: SEOState) -> dict:
    research = state.get("research", {})
    audit = state.get("audit", {})
    geo = state.get("geo_visibility", {}) or {}
    target = state["target"]

    human = (
        f"Brand: {target.get('brand_name')} ({target['domain']}), location: {target['location_name']}.\n"
        f"Low-hanging keywords: {[k['keyword'] for k in research.get('low_hanging', [])[:15]]}\n"
        f"Competitor gaps: {[g['keyword'] for g in research.get('gaps', [])[:15]]}\n"
        f"Technical audit: {audit.get('summary')}\n"
        f"On-page failed checks: {audit.get('onpage', {}).get('failed_checks')}\n"
        f"In local pack: {audit.get('brand_in_local_pack')}, GBP: {audit.get('gbp_listing')}\n"
        f"GEO uncited queries (prioritize briefs that close these): {geo.get('uncited_queries', [])[:10]}\n"
        f"GEO citable gaps (fold into the answer_first / outline fields): {geo.get('citable_gaps', [])[:5]}\n"
        "Produce the full strategy plan."
    )

    plan = await reason_structured(SYSTEM, human, StrategyPlan)
    strategy = plan.model_dump() if plan else _fallback_plan(state)

    log.info("strategy: %d briefs, %d geo pages", len(strategy["content_briefs"]), len(strategy["geo_landing_pages"]))
    return {"strategy": strategy}
