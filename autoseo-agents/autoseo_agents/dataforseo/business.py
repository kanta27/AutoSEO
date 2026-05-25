"""DataForSEO Business Data wrapper — Google Business Profile data.

`business_listings_search` is live and queries DataForSEO's GBP database by
title/category/area — ideal for pulling the brand's listing (rating, reviews,
hours, claimed status) and comparing against local competitors.

For the live, fully fresh Google Business Profile of a single brand you can also
use the task-based /v3/business_data/google/my_business_info/task_post +
.../task_get flow; left as an extension to avoid task polling here.
"""
from __future__ import annotations

from autoseo_agents.dataforseo.client import DataForSEOClient


async def business_listings_search(
    client: DataForSEOClient,
    title: str | None = None,
    categories: list[str] | None = None,
    location_coordinate: str | None = None,
    limit: int = 20,
) -> list[dict]:
    """Search GBP listings. `location_coordinate` is 'lat,lng,radius_km'."""
    payload: dict = {"limit": limit}
    if title:
        payload["title"] = title
    if categories:
        payload["categories"] = categories
    if location_coordinate:
        payload["location_coordinate"] = location_coordinate

    rows = await client.post(
        "/v3/business_data/business_listings/search/live", payload
    )
    items = (rows[0].get("items") if rows else None) or []
    out = []
    for it in items:
        rating = it.get("rating") or {}
        out.append(
            {
                "title": it.get("title"),
                "category": it.get("category"),
                "address": it.get("address"),
                "rating": rating.get("value"),
                "reviews": rating.get("votes_count"),
                "is_claimed": it.get("is_claimed"),
                "domain": it.get("domain"),
                "phone": it.get("phone"),
                "total_photos": it.get("total_photos"),
            }
        )
    return out
