"""DataForSEO SERP wrappers — Google Organic and Google Maps (Local)."""
from __future__ import annotations

from autoseo_agents.dataforseo.client import DataForSEOClient


async def google_organic(
    client: DataForSEOClient,
    keyword: str,
    location_code: int = 2840,
    language_code: str = "en",
    depth: int = 100,
) -> list[dict]:
    """Live organic SERP. Returns ordered organic results (position, url, title)."""
    rows = await client.post(
        "/v3/serp/google/organic/live/advanced",
        {
            "keyword": keyword,
            "location_code": location_code,
            "language_code": language_code,
            "device": "desktop",
            "depth": depth,
        },
    )
    items = (rows[0].get("items") if rows else None) or []
    out = []
    for it in items:
        if it.get("type") != "organic":
            continue
        out.append(
            {
                "position": it.get("rank_group"),
                "url": it.get("url"),
                "domain": it.get("domain"),
                "title": it.get("title"),
            }
        )
    return out


async def google_maps(
    client: DataForSEOClient,
    keyword: str,
    location_name: str,
    language_code: str = "en",
) -> list[dict]:
    """Live Google Maps / local-pack results for a query in a place.

    `location_name` uses DataForSEO format, e.g. 'Austin,Texas,United States'.
    """
    rows = await client.post(
        "/v3/serp/google/maps/live/advanced",
        {
            "keyword": keyword,
            "location_name": location_name,
            "language_code": language_code,
        },
    )
    items = (rows[0].get("items") if rows else None) or []
    out = []
    for it in items:
        rating = it.get("rating") or {}
        out.append(
            {
                "position": it.get("rank_group"),
                "title": it.get("title"),
                "domain": it.get("domain"),
                "rating": rating.get("value"),
                "reviews": rating.get("votes_count"),
                "address": it.get("address"),
                "category": it.get("category"),
                "place_id": it.get("place_id"),
            }
        )
    return out
