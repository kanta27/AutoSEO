"""Shared, typed state passed between agents through the LangGraph graph.

LangGraph merges each node's returned dict into this state by key (last write
wins). Agents read what upstream agents produced and write their own slice.
"""
from __future__ import annotations

from typing import Any, TypedDict


class BrandTarget(TypedDict, total=False):
    domain: str             # bare domain, e.g. "acme.com"
    brand_name: str         # display name for GBP/local lookups
    location_name: str      # e.g. "Austin,Texas,United States" (DataForSEO format)
    location_code: int      # DataForSEO location code, e.g. 2840 (US)
    language_code: str      # e.g. "en"
    seed_keywords: list[str]
    competitors: list[str]  # optional; auto-discovered if empty


class SEOState(TypedDict, total=False):
    target: BrandTarget

    # Per-agent output slices (plain JSON, so they serialize and pass cleanly).
    research: dict[str, Any]         # Agent 1
    audit: dict[str, Any]            # Agent 2
    geo_visibility: dict[str, Any]   # Agent A10 — GEO / LLM-Visibility Auditor
    strategy: dict[str, Any]         # Agent 3
    monitor: dict[str, Any]          # Agent 4

    # Loop control.
    iteration: int
    max_iterations: int
    needs_reoptimization: bool
    flags: list[str]           # human-readable reasons the loop should re-run

    # Cross-cutting.
    cost_usd: float            # accumulated DataForSEO spend
    errors: list[str]
