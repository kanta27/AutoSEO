"""DataForSEO Labs wrappers — keyword ideas, competitors, ranked keywords.

All endpoints here are *live* (synchronous): one POST returns results directly.
Each function normalizes DataForSEO's nested response into flat dicts so the
agents never touch raw payloads.
"""
from __future__ import annotations

from typing import Any

from autoseo_agents.dataforseo.client import DataForSEOClient


def _kw_metrics(node: dict) -> dict[str, Any]:
    info = node.get("keyword_info") or {}
    props = node.get("keyword_properties") or {}
    return {
        "search_volume": info.get("search_volume") or 0,
        "cpc": info.get("cpc") or 0.0,
        "competition": info.get("competition") or 0.0,
        "difficulty": props.get("keyword_difficulty"),
    }


async def keyword_ideas(
    client: DataForSEOClient,
    seed_keywords: list[str],
    location_code: int = 2840,
    language_code: str = "en",
    limit: int = 200,
) -> list[dict]:
    """Keyword expansion from seed terms — volume, CPC, competition, difficulty."""
    rows = await client.post(
        "/v3/dataforseo_labs/google/keyword_ideas/live",
        {
            "keywords": seed_keywords,
            "location_code": location_code,
            "language_code": language_code,
            "limit": limit,
        },
    )
    items = (rows[0].get("items") if rows else None) or []
    return [{"keyword": it.get("keyword"), **_kw_metrics(it)} for it in items if it.get("keyword")]


async def competitors_domain(
    client: DataForSEOClient,
    domain: str,
    location_code: int = 2840,
    language_code: str = "en",
    limit: int = 10,
) -> list[dict]:
    """Domains competing for the target's keywords, ranked by overlap."""
    rows = await client.post(
        "/v3/dataforseo_labs/google/competitors_domain/live",
        {
            "target": domain,
            "location_code": location_code,
            "language_code": language_code,
            "limit": limit,
        },
    )
    items = (rows[0].get("items") if rows else None) or []
    out = []
    for it in items:
        metrics = (it.get("metrics") or {}).get("organic") or {}
        out.append(
            {
                "domain": it.get("domain"),
                "intersections": it.get("intersections") or 0,
                "organic_keywords": metrics.get("count") or 0,
                "estimated_traffic": metrics.get("etv") or 0.0,
            }
        )
    return [c for c in out if c["domain"]]


async def ranked_keywords(
    client: DataForSEOClient,
    domain: str,
    location_code: int = 2840,
    language_code: str = "en",
    limit: int = 300,
) -> list[dict]:
    """Keywords a domain already ranks for, with position and landing URL."""
    rows = await client.post(
        "/v3/dataforseo_labs/google/ranked_keywords/live",
        {
            "target": domain,
            "location_code": location_code,
            "language_code": language_code,
            "limit": limit,
        },
    )
    items = (rows[0].get("items") if rows else None) or []
    out = []
    for it in items:
        kw = it.get("keyword_data") or {}
        serp = (it.get("ranked_serp_element") or {}).get("serp_item") or {}
        out.append(
            {
                "keyword": kw.get("keyword"),
                "position": serp.get("rank_group"),
                "url": serp.get("url"),
                **_kw_metrics(kw),
            }
        )
    return [r for r in out if r["keyword"]]
