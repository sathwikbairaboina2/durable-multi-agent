import json
from pathlib import Path
from typing import Any

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult

SEED = Path(__file__).resolve().parents[2] / "seed" / "catalog.json"
RUN_ID = "01J9ZX5K3M8Q4R6T7V9W1Y2Z3A"


class FakeChat(BaseChatModel):
    """Returns the next canned response on each call; repeats the last one past the end."""

    responses: list[AIMessage]
    calls: int = 0

    @property
    def _llm_type(self) -> str:
        return "fake"

    def _generate(
        self, messages: list[BaseMessage], stop: list[str] | None = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        i = min(self.calls, len(self.responses) - 1)
        self.calls += 1
        return ChatResult(generations=[ChatGeneration(message=self.responses[i])])


def ai(obj: Any, output_tokens: int = 10) -> AIMessage:
    text = obj if isinstance(obj, str) else json.dumps(obj)
    return AIMessage(
        content=text,
        usage_metadata={"input_tokens": 10, "output_tokens": output_tokens, "total_tokens": 10 + output_tokens},
    )


@pytest.fixture
def seed_catalog() -> list[dict]:
    items = json.loads(SEED.read_text(encoding="utf-8"))
    return [
        {k: i[k] for k in ("sku", "name", "unitPriceCents", "maxQtyPerOrder")} for i in items if i["active"]
    ]
