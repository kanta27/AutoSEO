"""Environment-driven configuration. Loads .env once at import time."""
from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    # DataForSEO credentials (required for any live data).
    dataforseo_login: str = os.getenv("DATAFORSEO_LOGIN", "")
    dataforseo_password: str = os.getenv("DATAFORSEO_PASSWORD", "")

    # Claude (optional — agents degrade gracefully without it).
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    model: str = os.getenv("AUTOSEO_MODEL", "claude-sonnet-4-6")

    # Tuning.
    max_concurrency: int = int(os.getenv("DATAFORSEO_MAX_CONCURRENCY", "5"))
    request_timeout: int = int(os.getenv("DATAFORSEO_TIMEOUT", "120"))
    daily_budget_usd: float = float(os.getenv("DATAFORSEO_DAILY_BUDGET", "5.0"))
    cache_dir: str = os.getenv("AUTOSEO_CACHE_DIR", "caches")

    @property
    def has_dataforseo(self) -> bool:
        return bool(self.dataforseo_login and self.dataforseo_password)

    @property
    def has_llm(self) -> bool:
        return bool(self.anthropic_api_key)


settings = Settings()
