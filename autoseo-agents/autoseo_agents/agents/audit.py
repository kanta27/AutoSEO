"""Agent 2 — Technical & Geo Auditor.

Objective: surface on-page technical defects and local/map optimization
opportunities. Tools: DataForSEO On-Page (instant page audit), SERP Maps
(local pack), Business Data (GBP listing).
"""
from __future__ import annotations

import logging

from autoseo_agents.agents.base import reason_text
from autoseo_agents.dataforseo import DataForSEOClient
from autoseo_agents.dataforseo import business, onpage, serp
from autoseo_agents.state import SEOState

log = logging.getLogger("autoseo.agents.audit")

SYSTEM = """You are the Technical & Geo Auditor for an autonomous SEO system.
You receive an on-page technical snapshot plus local-pack and Google Business
Profile data. Identify the technical defects most likely to suppress rankings
and the concrete local/map optimizations (claim listing, fill categories, grow
reviews, NAP consistency) that would lift local visibility. Be specific."""


async def audit_agent(state: SEOState) -> dict:
    target = state["target"]
    lang = target["language_code"]
    primary_kw = (target.get("seed_keywords") or ["business"])[0]
    flags: list[str] = []

    async with DataForSEOClient() as client:
        page = await onpage.instant_page(client, f"https://{target['domain']}")

        local_pack = await serp.google_maps(
            client, f"{primary_kw} {target['location_name'].split(',')[0]}",
            target["location_name"], lang,
        )
        listing = await business.business_listings_search(
            client, title=target.get("brand_name") or target["domain"], limit=10
        )
        cost = client.total_cost

    # Technical flags
    score = page.get("onpage_score")
    if score is not None and score < 90:
        flags.append(f"On-page score {score:.0f}/100 — technical issues present")
    if page.get("failed_checks"):
        flags.append(f"{len(page['failed_checks'])} on-page checks failing")

    # Local flags — is the brand even in the local pack?
    brand_in_pack = any(
        target["domain"] in (r.get("domain") or "") for r in local_pack
    )
    if local_pack and not brand_in_pack:
        flags.append("Brand absent from local pack for primary geo query")

    own_listing = listing[0] if listing else None
    if own_listing:
        if own_listing.get("is_claimed") is False:
            flags.append("Google Business Profile is unclaimed")
        if (own_listing.get("reviews") or 0) < 10:
            flags.append("Low Google review count (<10)")

    summary = await reason_text(
        SYSTEM,
        f"On-page: score={score}, failed={page.get('failed_checks')}, "
        f"words={page.get('word_count')}.\n"
        f"Local pack top 3: {[r.get('title') for r in local_pack[:3]]}.\n"
        f"Brand listing: {own_listing}.\n"
        "List the top 3 technical fixes and top 3 local fixes.",
    )

    log.info("audit: score=%s, %d local results, $%.4f", score, len(local_pack), cost)
    return {
        "audit": {
            "onpage": page,
            "local_pack": local_pack,
            "brand_in_local_pack": brand_in_pack,
            "gbp_listing": own_listing,
            "summary": summary,
        },
        "flags": state.get("flags", []) + flags,
        "cost_usd": state.get("cost_usd", 0.0) + cost,
    }
