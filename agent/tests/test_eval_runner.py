import importlib.util
import json
from pathlib import Path

EVALS = Path(__file__).resolve().parents[1] / "evals"
SEED = Path(__file__).resolve().parents[2] / "seed" / "catalog.json"

spec = importlib.util.spec_from_file_location("evals_run", EVALS / "run.py")
run = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run)


def test_request_set_is_well_formed():
    reqs = run.load_requests()
    assert len(reqs) == 30
    assert len({r["id"] for r in reqs}) == 30
    catalog = {c["sku"]: c for c in json.loads(SEED.read_text(encoding="utf-8"))}
    for r in reqs:
        assert r["expected"], r["id"]
        for e in r["expected"]:
            item = catalog[e["sku"]]
            assert item["active"], f"{r['id']} expects an inactive sku"
            assert 1 <= e["qty"] <= item["maxQtyPerOrder"], f"{r['id']} qty out of range"


def test_evaluate_returns_the_documented_shape():
    out = run.evaluate(run.load_requests()[:3], "scripted")
    assert out["n"] == 3
    for key in ("measuredAt", "model", "exactMatch", "exactMatchRate", "meanSecondsPerRequest", "errors", "claimedPriceMismatches", "perRequest"):
        assert key in out
    assert len(out["perRequest"]) == 3
    assert out["model"] == "scripted"
    assert out["ollamaModel"] is None
