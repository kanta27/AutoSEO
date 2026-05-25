"""LLM helper shared by agents.

Claude is optional: if ANTHROPIC_API_KEY is unset, these return None and each
agent falls back to deterministic logic, so the whole pipeline still runs on
DataForSEO data alone.
"""
from __future__ import annotations

import logging
from typing import Type, TypeVar

from pydantic import BaseModel

from autoseo_agents.config import settings

log = logging.getLogger("autoseo.agents")

T = TypeVar("T", bound=BaseModel)

_llm = None


def _get_llm():
    global _llm
    if not settings.has_llm:
        return None
    if _llm is None:
        from langchain_anthropic import ChatAnthropic

        _llm = ChatAnthropic(
            model=settings.model,
            temperature=0.2,
            max_tokens=3000,
            timeout=120,
        )
    return _llm


async def reason_text(system: str, human: str) -> str | None:
    """Free-form reasoning. Returns None when no LLM is configured."""
    llm = _get_llm()
    if llm is None:
        return None
    try:
        msg = await llm.ainvoke([("system", system), ("human", human)])
        return msg.content if isinstance(msg.content, str) else str(msg.content)
    except Exception as exc:  # never let an LLM hiccup kill the pipeline
        log.warning("LLM text call failed: %s", exc)
        return None


async def reason_structured(system: str, human: str, schema: Type[T]) -> T | None:
    """Structured reasoning into a Pydantic model. Returns None without an LLM."""
    llm = _get_llm()
    if llm is None:
        return None
    try:
        structured = llm.with_structured_output(schema)
        return await structured.ainvoke([("system", system), ("human", human)])
    except Exception as exc:
        log.warning("LLM structured call failed: %s", exc)
        return None
