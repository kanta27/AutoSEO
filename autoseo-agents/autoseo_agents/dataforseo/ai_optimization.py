"""DataForSEO AI Optimization wrappers — LLM Mentions + AI Keyword Volume.

Backs agent A10 (GEO / LLM-Visibility Auditor). Lets us measure citation share
across LLM responses (which brand/domains get cited for a given query) rather
than just classical SERP positions.

Endpoint paths verified against docs.dataforseo.com/v3/ai_optimization/overview
(retrieved at implementation time). Endpoints in this family are Live-only,
following the same shape as `labs.py`. If credentials lack AI Optimization
access, the client will raise DataForSEOError — A10 catches that and falls
back to LLM-only assessment, so the pipeline still runs end-to-end.
"""
from __future__ import annotations

from typing import Any

from autoseo_agents.dataforseo.client import DataForSEOClient


async def llm_mentions_search(
    client: DataForSEOClient,
    keyword: str,
    location_code: int = 2840,
    language_code: str = "en",
) -> list[dict]:
    """Domains/pages mentioned by LLMs in response to a query.

    Returns flat rows: `{url, domain, llm, snippet, mention_rank}`. The
    aggregation into per-domain citation share happens in the agent.
    """
    rows = await client.post(
        "/v3/ai_optimization/llm_mentions/search/live/",
        {
            "keyword": keyword,
            "location_code": location_code,
            "language_code": language_code,
        },
    )
    items = (rows[0].get("items") if rows else None) or []
    out: list[dict] = []
    for it in items:
        out.append(
            {
                "url": it.get("url"),
                "domain": it.get("domain"),
                "llm": it.get("llm") or it.get("source") or it.get("ai_engine"),
                "snippet": it.get("snippet") or it.get("text"),
                "mention_rank": it.get("rank_absolute") or it.get("rank_group"),
            }
        )
    return out


async def ai_keyword_volume(
    client: DataForSEOClient,
    keywords: list[str],
    location_code: int = 2840,
    language_code: str = "en",
) -> list[dict]:
    """Search-volume estimates and intent signals from LLM tool usage —
    distinct from classical Google search volume.
    """
    rows = await client.post(
        "/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live/",
        {
            "keywords": keywords,
            "location_code": location_code,
            "language_code": language_code,
        },
    )
    items = (rows[0].get("items") if rows else None) or []
    return [
        {
            "keyword": it.get("keyword"),
            "ai_search_volume": it.get("ai_search_volume") or it.get("search_volume") or 0,
            "intent": it.get("intent") or it.get("search_intent"),
        }
        for it in items
        if it.get("keyword")
    ]
