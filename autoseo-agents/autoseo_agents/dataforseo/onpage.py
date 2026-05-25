"""DataForSEO On-Page wrapper — single-page technical audit.

Uses `instant_pages` (live) so we get a full technical snapshot in one call
without the task_post → poll → task_get cycle. For a full-site crawl, swap to
the task-based /v3/on_page/task_post + /v3/on_page/pages flow.
"""
from __future__ import annotations

from typing import Any

from autoseo_agents.dataforseo.client import DataForSEOClient

# Checks where a True value means a problem (DataForSEO names many checks as the
# defect itself). Used to surface actionable issues without dumping all ~60 flags.
NEGATIVE_CHECKS = {
    "no_title", "no_description", "no_h1_tag", "title_too_long", "title_too_short",
    "no_image_alt", "no_image_title", "duplicate_title_tag", "duplicate_description",
    "is_http", "is_redirect", "is_4xx_code", "is_5xx_code", "is_broken",
    "canonical_chain", "no_doctype", "no_encoding_meta_tag", "high_loading_time",
    "small_page_size", "low_content_rate", "deprecated_html_tags", "no_favicon",
    "seo_friendly_url_characters_check", "no_content_encoding", "lorem_ipsum",
}


async def instant_page(
    client: DataForSEOClient,
    url: str,
    enable_javascript: bool = True,
) -> dict[str, Any]:
    """Audit one URL. Returns onpage_score, failed checks, and meta summary."""
    rows = await client.post(
        "/v3/on_page/instant_pages",
        {"url": url, "enable_javascript": enable_javascript},
    )
    items = (rows[0].get("items") if rows else None) or []
    if not items:
        return {"url": url, "ok": False, "reason": "no result returned"}

    page = items[0]
    checks = page.get("checks") or {}
    meta = page.get("meta") or {}
    timing = page.get("page_timing") or {}

    failed = sorted(k for k, v in checks.items() if v and k in NEGATIVE_CHECKS)

    return {
        "url": page.get("url", url),
        "ok": True,
        "onpage_score": page.get("onpage_score"),
        "status_code": page.get("status_code"),
        "failed_checks": failed,
        "title": meta.get("title"),
        "description": meta.get("description"),
        "internal_links": meta.get("internal_links_count"),
        "external_links": meta.get("external_links_count"),
        "word_count": (meta.get("content") or {}).get("plain_text_word_count"),
        "load_time_ms": timing.get("duration_time"),
    }
