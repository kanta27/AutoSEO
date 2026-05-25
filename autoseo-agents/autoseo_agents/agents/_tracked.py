"""Shared keyword-tracking helper.

The Monitor (A5-style rank tracker) and the GEO / LLM-Visibility Auditor (A10)
must measure the *same* set of queries — otherwise rank movements and citation
movements can't be correlated. This module is the single source of truth.
"""
from __future__ import annotations

from autoseo_agents.state import SEOState


def tracked_keywords(state: SEOState, limit: int = 15) -> list[str]:
    """De-duplicated, order-preserving list of keywords drawn from research
    output. Used by both monitor (rank movement) and geo_visibility (citation
    movement) so the two agents see the same query universe.
    """
    research = state.get("research", {})
    kws: list[str] = []
    for k in research.get("low_hanging", []):
        kws.append(k["keyword"])
    for g in research.get("gaps", []):
        kws.append(g["keyword"])
    seen, out = set(), []
    for k in kws:
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out[:limit]
