"""Robust async DataForSEO client.

Handles HTTP Basic auth, the array-of-tasks request envelope, concurrency
limiting, retry/backoff on rate limits & timeouts, status-code parsing, and a
hard per-run budget guard (spec §3.3 Budget Controller).

Usage:
    async with DataForSEOClient() as client:
        rows = await client.post("/v3/dataforseo_labs/google/keyword_ideas/live", payload)
"""
from __future__ import annotations

import asyncio
import base64
import logging
from typing import Any

import aiohttp
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from autoseo_agents.config import settings

log = logging.getLogger("autoseo.dataforseo")

BASE_URL = "https://api.dataforseo.com"

# DataForSEO envelope status codes (https://docs.dataforseo.com/v3/appendix/errors).
OK = 20000
TASK_CREATED = 20100
# Transient server-side codes worth retrying.
RETRYABLE_API_CODES = {40601, 50000, 50100, 50200, 50400}
RETRYABLE_HTTP = {429, 500, 502, 503, 504}


class DataForSEOError(Exception):
    """Non-recoverable API or usage error."""


class RetryableError(DataForSEOError):
    """Transient error — the retry decorator will back off and try again."""


class BudgetExceededError(DataForSEOError):
    """Raised when accumulated cost crosses the configured daily budget."""


class DataForSEOClient:
    def __init__(
        self,
        login: str | None = None,
        password: str | None = None,
        *,
        max_concurrency: int | None = None,
        timeout: int | None = None,
        budget_usd: float | None = None,
    ) -> None:
        self.login = login or settings.dataforseo_login
        self.password = password or settings.dataforseo_password
        if not (self.login and self.password):
            raise DataForSEOError(
                "Missing credentials. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD."
            )

        token = base64.b64encode(f"{self.login}:{self.password}".encode()).decode()
        self._headers = {
            "Authorization": f"Basic {token}",
            "Content-Type": "application/json",
        }
        self._sem = asyncio.Semaphore(max_concurrency or settings.max_concurrency)
        self._timeout = aiohttp.ClientTimeout(total=timeout or settings.request_timeout)
        self._budget = budget_usd if budget_usd is not None else settings.daily_budget_usd
        self._session: aiohttp.ClientSession | None = None
        self.total_cost: float = 0.0

    async def __aenter__(self) -> "DataForSEOClient":
        self._session = aiohttp.ClientSession(headers=self._headers, timeout=self._timeout)
        return self

    async def __aexit__(self, *exc: Any) -> None:
        if self._session:
            await self._session.close()
            self._session = None

    # --- public API ----------------------------------------------------------

    async def post(self, path: str, payload: dict | list[dict]) -> list[dict]:
        """POST one or more task objects; return the flattened `result` rows."""
        body = payload if isinstance(payload, list) else [payload]
        data = await self._request("POST", path, json=body)
        return self._extract_results(data, path)

    async def get(self, path: str) -> list[dict]:
        """GET (used for task_get polling endpoints)."""
        data = await self._request("GET", path)
        return self._extract_results(data, path)

    # --- internals -----------------------------------------------------------

    @retry(
        reraise=True,
        stop=stop_after_attempt(4),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        retry=retry_if_exception_type(RetryableError),
    )
    async def _request(self, method: str, path: str, **kwargs: Any) -> dict:
        if self._session is None:
            raise DataForSEOError("Client not started. Use 'async with DataForSEOClient()'.")
        url = f"{BASE_URL}{path}"
        async with self._sem:
            try:
                async with self._session.request(method, url, **kwargs) as resp:
                    if resp.status in RETRYABLE_HTTP:
                        text = await resp.text()
                        raise RetryableError(f"HTTP {resp.status} on {path}: {text[:200]}")
                    if resp.status >= 400:
                        text = await resp.text()
                        raise DataForSEOError(f"HTTP {resp.status} on {path}: {text[:300]}")
                    return await resp.json()
            except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
                raise RetryableError(f"Network error on {path}: {exc}") from exc

    def _extract_results(self, data: dict, path: str) -> list[dict]:
        status = data.get("status_code")
        if status not in (OK, TASK_CREATED):
            if status in RETRYABLE_API_CODES:
                raise RetryableError(f"{path}: {status} {data.get('status_message')}")
            raise DataForSEOError(f"{path}: {status} {data.get('status_message')}")

        results: list[dict] = []
        for task in data.get("tasks") or []:
            self.total_cost += float(task.get("cost") or 0.0)
            if self.total_cost > self._budget:
                raise BudgetExceededError(
                    f"Budget ${self._budget:.2f} exceeded (spent ${self.total_cost:.4f})."
                )
            tcode = task.get("status_code")
            if tcode not in (OK, TASK_CREATED):
                log.warning("task error on %s: %s %s", path, tcode, task.get("status_message"))
                continue
            results.extend(task.get("result") or [])
        return results
