import pytest
from pydantic import ValidationError

from procurement_agent.schemas import Invocation, ProposedOrder

RUN_ID = "01J9ZX5K3M8Q4R6T7V9W1Y2Z3A"


def order(**over):
    base = {
        "runId": RUN_ID,
        "currency": "USD",
        "lines": [{"sku": "A", "qty": 1}],
        "justification": "ok",
    }
    base.update(over)
    return base


def test_valid_order_parses():
    assert ProposedOrder(**order()).lines[0].qty == 1


@pytest.mark.parametrize(
    "bad",
    [
        order(extra=1),
        order(lines=[{"sku": "A", "qty": 0}]),
        order(lines=[{"sku": "A", "qty": 51}]),
        order(lines=[{"sku": "A", "qty": 1}] * 11),
        order(lines=[]),
        order(currency="EUR"),
        order(runId="nope"),
        order(lines=[{"sku": "A", "qty": 1, "hack": True}]),
    ],
)
def test_bad_orders_rejected(bad):
    with pytest.raises(ValidationError):
        ProposedOrder(**bad)


def test_invocation_requires_catalog():
    with pytest.raises(ValidationError):
        Invocation(runId=RUN_ID, request="x", catalog=[])
