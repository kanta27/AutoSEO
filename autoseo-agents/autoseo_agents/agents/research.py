"""Agent 1 — Research & Competitor Analyst.

Objective: find low-hanging fruit (high volume / low difficulty), high-value
keywords, and competitor gaps (terms competitors rank for that we don't).
Tools: DataForSEO Labs (keyword ideas, competitors, ranked keywords).
"""
from __future__ import annotations

import logging

from autoseo_agents.agents.base import reason_text
from autoseo_agents.dataforseo import DataForSEOClient
from autoseo_agents.dataforseo import labs
from autoseo_agents.state import SEOState

log = logging.getLogger("autoseo.agents.research")

SYSTEM = """You are the Research & Competitor Analyst for an autonomous SEO system.
Given keyword metrics and competitor data, identify the highest-leverage
opportunities: low-difficulty/high-volume "low-hanging fruit", commercial-intent
terms, and gaps where competitors rank but the brand does not. Be concise and
prioritize by likely traffic-at-risk × ease of winning."""


def _low_hanging(ideas: list[dict], max_difficulty: int = 30, min_volume: int = 100) -> list[dict]:
    picks = [
        k
        for k in ideas
        if (k.get("difficulty") is None or k["difficulty"] <= max_difficulty)
        and (k.get("search_volume") or 0) >= min_volume
    ]
    picks.sort(key=lambda k: (k.get("search_volume") or 0), reverse=True)
    return picks[:30]


async def research_agent(state: SEOState) -> dict:
    target = state["target"]
    loc, lang = target["location_code"], target["language_code"]
    flags: list[str] = []

    async with DataForSEOClient() as client:
        ideas = await labs.keyword_ideas(client, target["seed_keywords"], loc, lang, limit=200)

        competitors = list(target.get("competitors") or [])
        if not competitors:
            discovered = await labs.competitors_domain(client, target["domain"], loc, lang, limit=8)
            competitors = [c["domain"] for c in discovered]

        own = await labs.ranked_keywords(client, target["domain"], loc, lang, limit=300)
        own_terms = {r["keyword"] for r in own}

        gaps: list[dict] = []
        for comp in competitors[:3]:
            comp_ranked = await labs.ranked_keywords(client, comp, loc, lang, limit=200)
            for r in comp_ranked:
                if (r.get("position") or 99) <= 10 and r["keyword"] not in own_terms:
                    gaps.append({**r, "competitor": comp})

        cost = client.total_cost

    # De-dupe gaps by keyword, keep the best (lowest) competitor position.
    best_gap: dict[str, dict] = {}
    for g in gaps:
        k = g["keyword"]
        if k not in best_gap or (g.get("position") or 99) < (best_gap[k].get("position") or 99):
            best_gap[k] = g
    gap_list = sorted(best_gap.values(), key=lambda g: (g.get("search_volume") or 0), reverse=True)[:30]

    low_hanging = _low_hanging(ideas)

    if len(low_hanging) >= 5:
        flags.append(f"{len(low_hanging)} low-hanging keyword opportunities found")
    if gap_list:
        flags.append(f"{len(gap_list)} competitor keyword gaps to close")

    summary = await reason_text(
        SYSTEM,
        f"Brand domain: {target['domain']}\n"
        f"Top low-hanging keywords: {[k['keyword'] for k in low_hanging[:15]]}\n"
        f"Competitor gaps: {[g['keyword'] for g in gap_list[:15]]}\n"
        "Give a 3-sentence prioritized read on where to focus first.",
    )

    log.info("research: %d ideas, %d gaps, $%.4f", len(ideas), len(gap_list), cost)
    return {
        "research": {
            "competitors": competitors,
            "low_hanging": low_hanging,
            "gaps": gap_list,
            "own_ranked_count": len(own),
            "summary": summary,
        },
        "flags": state.get("flags", []) + flags,
        "cost_usd": state.get("cost_usd", 0.0) + cost,
    }
