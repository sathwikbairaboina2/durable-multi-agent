"""Run the 30-request procurement eval.

    uv run python evals/run.py --model ollama --limit 30 --out evals/results/latest.json

The scripted model is a stand-in for tests. Its score says nothing about model quality, so
results from it are never reported as a model score.
"""

import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from procurement_agent.graph import run_team
from procurement_agent.models import make_model
from procurement_agent.nodes import AgentBudgetExceeded, AgentOutputInvalid
from procurement_agent.schemas import Invocation

HERE = Path(__file__).resolve().parent
SEED = HERE.parents[1] / "seed" / "catalog.json"
RUN_ID = "01J9ZX5K3M8Q4R6T7V9W1Y2Z3A"


def load_requests(limit: int | None = None) -> list[dict]:
    lines = (HERE / "requests.jsonl").read_text(encoding="utf-8").splitlines()
    items = [json.loads(ln) for ln in lines if ln.strip()]
    return items[:limit] if limit else items


def active_catalog() -> list[dict]:
    items = json.loads(SEED.read_text(encoding="utf-8"))
    return [{k: i[k] for k in ("sku", "name", "unitPriceCents", "maxQtyPerOrder")} for i in items if i["active"]]


def evaluate(requests: list[dict], model_name: str) -> dict:
    catalog = active_catalog()
    price = {c["sku"]: c["unitPriceCents"] for c in catalog}
    model = make_model(model_name)
    per_request = []
    exact = errors = price_mismatches = 0
    total_seconds = 0.0
    for r in requests:
        started = time.monotonic()
        entry = {"id": r["id"], "request": r["request"], "expected": r["expected"]}
        try:
            out = run_team(Invocation(runId=RUN_ID, request=r["request"], catalog=catalog), model)
            got = {(ln["sku"], ln["qty"]) for ln in out["proposal"]["lines"]}
            want = {(e["sku"], e["qty"]) for e in r["expected"]}
            entry["got"] = [{"sku": s, "qty": q} for s, q in sorted(got)]
            entry["exactMatch"] = got == want
            exact += int(got == want)
            for ln in out["proposal"]["lines"]:
                claimed = ln.get("claimedUnitPriceCents")
                if claimed is not None and claimed != price.get(ln["sku"]):
                    price_mismatches += 1
        except (AgentOutputInvalid, AgentBudgetExceeded) as e:
            errors += 1
            entry["error"] = f"{type(e).__name__}: {e}"
            entry["exactMatch"] = False
        entry["seconds"] = round(time.monotonic() - started, 2)
        total_seconds += entry["seconds"]
        per_request.append(entry)
    n = len(requests)
    return {
        "measuredAt": datetime.now(timezone.utc).isoformat(),
        "model": model_name,
        "ollamaModel": os.environ.get("OLLAMA_MODEL", "qwen3.8:27b") if model_name == "ollama" else None,
        "n": n,
        "exactMatch": exact,
        "exactMatchRate": round(exact / n, 4) if n else None,
        "meanSecondsPerRequest": round(total_seconds / n, 2) if n else None,
        "errors": errors,
        "claimedPriceMismatches": price_mismatches,
        "perRequest": per_request,
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="ollama")
    p.add_argument("--limit", type=int, default=30)
    p.add_argument("--out", default=str(HERE / "results" / "latest.json"))
    args = p.parse_args()
    result = evaluate(load_requests(args.limit), args.model)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"{result['exactMatch']}/{result['n']} exact matches, {result['errors']} errors, {result['meanSecondsPerRequest']} s/request")


if __name__ == "__main__":
    main()
