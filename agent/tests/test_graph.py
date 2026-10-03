import pytest
from conftest import RUN_ID, FakeChat, ai

from procurement_agent.graph import route, run_team
from procurement_agent.nodes import AgentOutputInvalid
from procurement_agent.schemas import Invocation, ProposedOrder

CATALOG = [{"sku": "GPU-DEVBOX-4090", "name": "GPU dev box (RTX 4090)", "unitPriceCents": 289900, "maxQtyPerOrder": 5}]
INTAKE = {"items": [{"description": "GPU dev boxes", "qty": 3}]}
SOURCING = {"lines": [{"sku": "GPU-DEVBOX-4090", "qty": 3, "claimedUnitPriceCents": 289900}]}
JUSTIFICATION = {"justification": "ML team needs capacity."}


def inv() -> Invocation:
    return Invocation(runId=RUN_ID, request="3 GPU dev boxes", catalog=CATALOG)


def test_happy_path():
    model = FakeChat(responses=[ai(INTAKE), ai(SOURCING), ai(JUSTIFICATION)])
    out = run_team(inv(), model)
    ProposedOrder(**out["proposal"])
    assert out["proposal"]["lines"][0]["sku"] == "GPU-DEVBOX-4090"
    assert model.calls == 3
    assert out["usage"]["modelSteps"] == 3
    assert out["model"] == "fake"


def test_repair_after_non_json():
    model = FakeChat(responses=[ai(INTAKE), ai("not json"), ai(SOURCING), ai(JUSTIFICATION)])
    out = run_team(inv(), model)
    assert out["proposal"]["lines"][0]["qty"] == 3
    assert model.calls == 4


def test_unknown_sku_twice_fails():
    bad = {"lines": [{"sku": "NOPE", "qty": 1}]}
    model = FakeChat(responses=[ai(INTAKE), ai(bad)])
    with pytest.raises(AgentOutputInvalid):
        run_team(inv(), model)


def test_fenced_json_is_accepted():
    model = FakeChat(responses=[ai("```json\n" + '{"items":[{"description":"x","qty":1}]}' + "\n```"), ai(SOURCING), ai(JUSTIFICATION)])
    assert run_team(inv(), model)["proposal"]["runId"] == RUN_ID


def test_route():
    assert route({}) == "intake"
    assert route({"requirements": [{}]}) == "sourcing"
    assert route({"requirements": [{}], "lines": []}) == "sourcing"
    assert route({"requirements": [{}], "lines": [{}]}) == "justification"
    assert route({"requirements": [{}], "lines": [{}], "justification": "x"}) == "__end__"
