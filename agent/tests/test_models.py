import json

import pytest
from langchain_core.messages import HumanMessage, SystemMessage

from procurement_agent.models import ScriptedChatModel, make_model


def ask(node: str, payload: dict) -> dict:
    out = ScriptedChatModel().invoke([SystemMessage(f"[node:{node}] x"), HumanMessage(json.dumps(payload))])
    return json.loads(out.content)


REQUEST = "We need 3 more GPU dev boxes for the ML team, under $9k"


def test_intake_reads_the_quantity():
    r = ask("intake", {"request": REQUEST})
    assert r["items"][0]["qty"] == 3


def test_intake_defaults_and_clamps():
    assert ask("intake", {"request": "a monitor"})["items"][0]["qty"] == 1
    assert ask("intake", {"request": "900 monitors"})["items"][0]["qty"] == 50


def test_sourcing_picks_the_gpu_box(seed_catalog):
    r = ask("sourcing", {"items": [{"description": REQUEST, "qty": 3}], "catalog": seed_catalog})
    assert r["lines"][0]["sku"] == "GPU-DEVBOX-4090"
    assert r["lines"][0]["qty"] == 3


def test_sourcing_returns_nothing_when_nothing_matches(seed_catalog):
    r = ask("sourcing", {"items": [{"description": "zzz qqq", "qty": 1}], "catalog": seed_catalog})
    assert r["lines"] == []


def test_justification_is_bounded():
    lines = [{"sku": "A", "name": "N" * 3000, "qty": 1, "unitPriceCents": 100}]
    r = ask("justification", {"request": REQUEST, "lines": lines})
    assert 0 < len(r["justification"]) <= 2000


def test_usage_metadata_is_reported():
    out = ScriptedChatModel().invoke([SystemMessage("[node:intake] x"), HumanMessage(json.dumps({"request": "a"}))])
    assert out.usage_metadata["output_tokens"] > 0


def test_factory_errors(monkeypatch):
    monkeypatch.delenv("BEDROCK_MODEL_ID", raising=False)
    with pytest.raises(ValueError, match="BEDROCK_MODEL_ID is required"):
        make_model("bedrock")
    with pytest.raises(ValueError, match="unknown AGENT_MODEL nope"):
        make_model("nope")


def test_factory_default_is_scripted(monkeypatch):
    monkeypatch.delenv("AGENT_MODEL", raising=False)
    assert make_model()._llm_type == "scripted"
