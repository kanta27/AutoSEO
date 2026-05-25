"""CLI entrypoint — run the autonomous SEO + GEO pipeline for one brand.

Examples
--------
    python main.py --domain acme.com --brand "Acme Plumbing" \
        --location "Austin,Texas,United States" --location-code 2840 \
        --keywords "emergency plumber,water heater repair,drain cleaning" \
        --max-iterations 2

    # Or point it at a JSON target file:
    python main.py --target targets/acme.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

from autoseo_agents.config import settings
from autoseo_agents.orchestration import run_pipeline
from autoseo_agents.state import BrandTarget, SEOState


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Autonomous SEO + GEO multi-agent pipeline.")
    p.add_argument("--target", help="Path to a JSON file describing the brand target.")
    p.add_argument("--domain", help="Bare domain, e.g. acme.com")
    p.add_argument("--brand", default="", help="Brand display name (for GBP lookups).")
    p.add_argument("--location", default="United States",
                   help="DataForSEO location_name, e.g. 'Austin,Texas,United States'.")
    p.add_argument("--location-code", type=int, default=2840, help="DataForSEO location_code (2840=US).")
    p.add_argument("--language-code", default="en")
    p.add_argument("--keywords", default="", help="Comma-separated seed keywords.")
    p.add_argument("--competitors", default="", help="Comma-separated competitor domains (optional).")
    p.add_argument("--max-iterations", type=int, default=1,
                   help="Re-optimization loop cap (1 = single pass, no loop).")
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args()


def _build_target(args: argparse.Namespace) -> BrandTarget:
    if args.target:
        data = json.loads(Path(args.target).read_text(encoding="utf-8"))
        return data  # trust the file shape (BrandTarget)
    if not args.domain or not args.keywords:
        sys.exit("error: --domain and --keywords are required (or pass --target file.json)")
    return {
        "domain": args.domain.replace("https://", "").replace("http://", "").strip("/"),
        "brand_name": args.brand or args.domain,
        "location_name": args.location,
        "location_code": args.location_code,
        "language_code": args.language_code,
        "seed_keywords": [k.strip() for k in args.keywords.split(",") if k.strip()],
        "competitors": [c.strip() for c in args.competitors.split(",") if c.strip()],
    }


def _print_report(final: SEOState) -> None:
    research = final.get("research", {})
    audit = final.get("audit", {})
    strategy = final.get("strategy", {})
    monitor = final.get("monitor", {})

    print("\n" + "=" * 64)
    print(f"  AutoSEO report — {final['target']['domain']}")
    print("=" * 64)
    print(f"  Iterations run : {final.get('iteration')}")
    print(f"  DataForSEO cost: ${final.get('cost_usd', 0.0):.4f}")
    print(f"  Competitors    : {research.get('competitors')}")
    print(f"  Low-hanging kw : {len(research.get('low_hanging', []))}")
    print(f"  Competitor gaps: {len(research.get('gaps', []))}")
    print(f"  On-page score  : {audit.get('onpage', {}).get('onpage_score')}")
    print(f"  In local pack  : {audit.get('brand_in_local_pack')}")
    print(f"  Content briefs : {len(strategy.get('content_briefs', []))}")
    print(f"  Geo pages       : {len(strategy.get('geo_landing_pages', []))}")
    print(f"  Rank drops     : {len(monitor.get('drops', []))}")
    print("\n  Flags:")
    for f in final.get("flags", []):
        print(f"    - {f}")

    out = Path("reports")
    out.mkdir(exist_ok=True)
    report_path = out / f"{final['target']['domain'].replace('.', '_')}.json"
    report_path.write_text(json.dumps(final, indent=2, default=str), encoding="utf-8")
    print(f"\n  Full JSON report → {report_path}\n")


async def _main() -> None:
    args = _parse_args()
    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )

    if not settings.has_dataforseo:
        sys.exit("error: set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD (see .env.example)")
    if not settings.has_llm:
        print("note: ANTHROPIC_API_KEY unset — running with deterministic fallbacks.\n")

    target = _build_target(args)
    initial: SEOState = {
        "target": target,
        "iteration": 0,
        "max_iterations": args.max_iterations,
        "flags": [],
        "errors": [],
        "cost_usd": 0.0,
    }

    final = await run_pipeline(initial)
    _print_report(final)


if __name__ == "__main__":
    asyncio.run(_main())
