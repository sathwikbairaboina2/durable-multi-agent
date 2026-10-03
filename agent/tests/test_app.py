from conftest import RUN_ID
from starlette.testclient import TestClient

from procurement_agent.app import app

CATALOG = [{"sku": "GPU-DEVBOX-4090", "name": "GPU dev box (RTX 4090)", "unitPriceCents": 289900, "maxQtyPerOrder": 5}]


def test_ping():
    r = TestClient(app).get("/ping")
    assert r.status_code == 200
    assert r.json()["status"] == "Healthy"


def test_invocation_with_the_scripted_model(monkeypatch):
    monkeypatch.setenv("AGENT_MODEL", "scripted")
    r = TestClient(app).post("/invocations", json={"runId": RUN_ID, "request": "3 GPU dev boxes", "catalog": CATALOG})
    assert r.status_code == 200
    body = r.json()
    assert body["proposal"]["runId"] == RUN_ID
    assert body["proposal"]["lines"][0]["sku"] == "GPU-DEVBOX-4090"
    assert body["model"] == "scripted"
    assert body["usage"]["modelSteps"] == 3


def test_missing_catalog_returns_an_error_envelope(monkeypatch):
    monkeypatch.setenv("AGENT_MODEL", "scripted")
    r = TestClient(app).post("/invocations", json={"runId": RUN_ID, "request": "3 GPU dev boxes"})
    assert r.status_code == 200
    assert r.json()["error"]["type"] == "ValidationError"
