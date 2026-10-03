from typing import Any, TypedDict

from langchain_core.language_models.chat_models import BaseChatModel
from langgraph.errors import GraphRecursionError
from langgraph.graph import END, START, StateGraph

from .nodes import AgentBudgetExceeded, call_json
from .schemas import Invocation, Justification, ProposedOrder, Requirements, SourcedLine, Sourcing


class State(TypedDict, total=False):
    run_id: str
    request: str
    catalog: list[dict[str, Any]]
    requirements: list[dict[str, Any]]
    lines: list[dict[str, Any]]
    justification: str
    usage: dict[str, int]


def route(state: State) -> str:
    if not state.get("requirements"):
        return "intake"
    if not state.get("lines"):
        return "sourcing"
    if not state.get("justification"):
        return "justification"
    return END


def _add_usage(state: State, new: dict[str, int], max_output_tokens: int) -> dict[str, int]:
    total = dict(state.get("usage") or {"input_tokens": 0, "output_tokens": 0, "model_steps": 0})
    for k, v in new.items():
        total[k] = total.get(k, 0) + v
    if total["output_tokens"] > max_output_tokens:
        raise AgentBudgetExceeded("tokens")
    return total


def build_graph(model: BaseChatModel, max_output_tokens: int = 40_000):
    def intake(state: State) -> State:
        obj, usage = call_json(
            model,
            "intake",
            "Extract what the requester wants to buy as items with a quantity each.",
            {"request": state["request"]},
            Requirements,
        )
        return {"requirements": [i.model_dump() for i in obj.items], "usage": _add_usage(state, usage, max_output_tokens)}

    def sourcing(state: State) -> State:
        skus = {c["sku"] for c in state["catalog"]}

        def check(obj: Sourcing) -> None:
            for line in obj.lines:
                if line.sku not in skus:
                    raise ValueError(f"unknown sku {line.sku}")

        obj, usage = call_json(
            model,
            "sourcing",
            "Map each item to a SKU from the catalog. Use only SKUs from the catalog.",
            {"items": state["requirements"], "catalog": state["catalog"]},
            Sourcing,
            extra_check=check,
        )
        return {"lines": [ln.model_dump(exclude_none=True) for ln in obj.lines], "usage": _add_usage(state, usage, max_output_tokens)}

    def justification(state: State) -> State:
        by_sku = {c["sku"]: c for c in state["catalog"]}
        lines = [
            {"sku": ln["sku"], "name": by_sku[ln["sku"]]["name"], "qty": ln["qty"], "unitPriceCents": by_sku[ln["sku"]]["unitPriceCents"]}
            for ln in state["lines"]
        ]
        obj, usage = call_json(
            model,
            "justification",
            "Write a one-paragraph business justification for this purchase.",
            {"request": state["request"], "lines": lines},
            Justification,
        )
        return {"justification": obj.justification, "usage": _add_usage(state, usage, max_output_tokens)}

    g = StateGraph(State)
    g.add_node("intake", intake)
    g.add_node("sourcing", sourcing)
    g.add_node("justification", justification)
    path_map = {"intake": "intake", "sourcing": "sourcing", "justification": "justification", END: END}
    g.add_conditional_edges(START, route, path_map)
    for name in ("intake", "sourcing", "justification"):
        g.add_conditional_edges(name, route, path_map)
    return g.compile()


def run_team(
    invocation: Invocation,
    model: BaseChatModel,
    recursion_limit: int = 12,
    max_output_tokens: int = 40_000,
) -> dict[str, Any]:
    graph = build_graph(model, max_output_tokens)
    try:
        final = graph.invoke(
            {
                "run_id": invocation.runId,
                "request": invocation.request,
                "catalog": [c.model_dump() for c in invocation.catalog],
                "usage": {"input_tokens": 0, "output_tokens": 0, "model_steps": 0},
            },
            config={"recursion_limit": recursion_limit},
        )
    except GraphRecursionError as e:
        raise AgentBudgetExceeded("steps") from e
    order = ProposedOrder(
        runId=invocation.runId,
        currency="USD",
        lines=[SourcedLine(**ln) for ln in final["lines"]],
        justification=final["justification"],
    )
    usage = final["usage"]
    return {
        "proposal": order.model_dump(exclude_none=True),
        "usage": {
            "inputTokens": usage["input_tokens"],
            "outputTokens": usage["output_tokens"],
            "modelSteps": usage["model_steps"],
        },
        "model": getattr(model, "_llm_type", type(model).__name__),
    }
