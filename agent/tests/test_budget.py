import pytest
from conftest import RUN_ID, FakeChat, ai

from procurement_agent.graph import run_team
from procurement_agent.nodes import AgentBudgetExceeded
from procurement_agent.schemas import Invocation

CATALOG = [{"sku": "GPU-DEVBOX-4090", "name": "GPU dev box (RTX 4090)", "unitPriceCents": 289900, "maxQtyPerOrder": 5}]
INTAKE = {"items": [{"description": "GPU dev boxes", "qty": 3}]}
SOURCING = {"lines": [{"sku": "GPU-DEVBOX-4090", "qty": 3}]}


def inv() -> Invocation:
    return Invocation(runId=RUN_ID, request="3 GPU dev boxes", catalog=CATALOG)


def test_step_limit():
    """I10: a model that never finds a SKU is stopped by the graph step limit."""
    model = FakeChat(responses=[ai(INTAKE), ai({"lines": []})])
    with pytest.raises(AgentBudgetExceeded, match="steps"):
        run_team(inv(), model)


def test_token_limit():
    """I10: output tokens over 40k stop the run after at most 2 model calls."""
    model = FakeChat(responses=[ai(INTAKE, output_tokens=25_000), ai(SOURCING, output_tokens=25_000)])
    with pytest.raises(AgentBudgetExceeded, match="tokens"):
        run_team(inv(), model)
    assert model.calls <= 2
