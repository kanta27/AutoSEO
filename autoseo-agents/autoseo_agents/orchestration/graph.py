"""LangGraph wiring: Research -> Audit -> Strategy -> Monitor, with an iterative
re-optimization loop back to Research while pages need attention.

The shared SEOState dict is the only thing passed between nodes; each agent
returns a partial dict that LangGraph merges in.
"""
from __future__ import annotations

import logging

from langgraph.graph import END, StateGraph

from autoseo_agents.agents import (
    audit_agent,
    geo_visibility_agent,
    monitor_agent,
    research_agent,
    strategy_agent,
)
from autoseo_agents.state import SEOState

log = logging.getLogger("autoseo.graph")


def _should_continue(state: SEOState) -> str:
    """Loop back to Research only if something regressed AND we have budget of
    iterations left. Otherwise finish."""
    iteration = state.get("iteration", 0)
    max_iter = state.get("max_iterations", 1)
    if state.get("needs_reoptimization") and iteration < max_iter:
        log.info("looping: iteration %d/%d, flags=%s", iteration, max_iter, state.get("flags"))
        return "loop"
    return "end"


def build_graph():
    builder = StateGraph(SEOState)

    builder.add_node("research", research_agent)
    builder.add_node("audit", audit_agent)
    builder.add_node("geo_visibility", geo_visibility_agent)
    builder.add_node("strategy", strategy_agent)
    builder.add_node("monitor", monitor_agent)

    builder.set_entry_point("research")
    builder.add_edge("research", "audit")
    builder.add_edge("audit", "geo_visibility")
    builder.add_edge("geo_visibility", "strategy")
    builder.add_edge("strategy", "monitor")
    builder.add_conditional_edges(
        "monitor", _should_continue, {"loop": "research", "end": END}
    )

    return builder.compile()


async def run_pipeline(initial_state: SEOState) -> SEOState:
    graph = build_graph()
    # recursion_limit guards against runaway loops independent of max_iterations.
    return await graph.ainvoke(initial_state, config={"recursion_limit": 50})
