"""Agent 4 — Performance & Monitoring Agent.

Objective: track daily rank movements for the keywords in play and flag pages
that regressed (position drop >= 3 or fell out of top 10) so the loop can
re-optimize them. Tools: DataForSEO SERP (Google Organic).

Rank history is persisted to {cache_dir}/rankings.json keyed by keyword, so
movement is measured run-over-run.
"""
from __future__ import annotations

import json
import logging
from datetime import date
from pathlib import Path

from autoseo_agents.agents._tracked import tracked_keywords
from autoseo_agents.config import settings
from autoseo_agents.dataforseo import DataForSEOClient
from autoseo_agents.dataforseo import serp
from autoseo_agents.state import SEOState

log = logging.getLogger("autoseo.agents.monitor")

DROP_THRESHOLD = 3  # positions


def _store_path(domain: str) -> Path:
    d = Path(settings.cache_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d / f"rankings_{domain.replace('.', '_')}.json"


def _load(domain: str) -> dict:
    p = _store_path(domain)
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {}


def _save(domain: str, data: dict) -> None:
    _store_path(domain).write_text(json.dumps(data, indent=2), encoding="utf-8")


async def monitor_agent(state: SEOState) -> dict:
    target = state["target"]
    domain = target["domain"]
    loc, lang = target["location_code"], target["language_code"]
    history = _load(domain)
    today = date.today().isoformat()

    keywords = tracked_keywords(state)
    movements: list[dict] = []
    flags: list[str] = []

    async with DataForSEOClient() as client:
        for kw in keywords:
            results = await serp.google_organic(client, kw, loc, lang, depth=100)
            position = next(
                (r["position"] for r in results if domain in (r.get("domain") or "")), None
            )
            prev_entry = history.get(kw, {})
            prev = prev_entry.get("position")

            delta = None
            if prev is not None and position is not None:
                delta = prev - position  # positive = improved
            elif prev is not None and position is None:
                delta = -99  # fell off tracked depth entirely

            dropped = (
                position is None and prev is not None
            ) or (delta is not None and delta <= -DROP_THRESHOLD)

            if dropped:
                flags.append(f"'{kw}' dropped ({prev} -> {position})")
                movements.append({"keyword": kw, "prev": prev, "now": position, "delta": delta, "dropped": True})
            elif delta is not None and delta != 0:
                movements.append({"keyword": kw, "prev": prev, "now": position, "delta": delta, "dropped": False})

            history[kw] = {"position": position, "date": today}

        cost = client.total_cost

    _save(domain, history)
    needs_reopt = bool(flags)

    log.info("monitor: tracked %d keywords, %d drops, $%.4f", len(keywords), len(flags), cost)
    return {
        "monitor": {
            "tracked": keywords,
            "movements": movements,
            "drops": [m for m in movements if m["dropped"]],
            "date": today,
        },
        "needs_reoptimization": needs_reopt,
        "flags": state.get("flags", []) + flags,
        "iteration": state.get("iteration", 0) + 1,
        "cost_usd": state.get("cost_usd", 0.0) + cost,
    }
