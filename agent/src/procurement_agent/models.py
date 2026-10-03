import json
import math
import os
import re
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def _approx_tokens(text: str) -> int:
    return math.ceil(len(text) / 4)


class ScriptedChatModel(BaseChatModel):
    """A deterministic stand-in for a model. It reads the node name from the system prompt.

    It exists so the demo, the benchmark and the tests run fast and offline. Its answers say
    nothing about model quality, and no score from it is reported as such.
    """

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def _answer(self, node: str, payload: dict[str, Any]) -> dict[str, Any]:
        if node == "intake":
            request = str(payload.get("request", ""))
            m = re.search(r"\d+", request)
            qty = min(50, max(1, int(m.group()))) if m else 1
            return {"items": [{"description": request, "qty": qty}]}

        if node == "sourcing":
            catalog = payload.get("catalog", [])
            lines = []
            for item in payload.get("items", []):
                want = _tokens(str(item.get("description", "")))
                best = None
                best_key = (0, 0)
                for entry in catalog:
                    have = _tokens(f"{entry['name']} {entry['sku'].replace('-', ' ')}")
                    score = len(want & have)
                    key = (score, -int(entry["unitPriceCents"]))
                    if score > 0 and (best is None or key > best_key):
                        best, best_key = entry, key
                if best is not None:
                    lines.append(
                        {
                            "sku": best["sku"],
                            "qty": int(item["qty"]),
                            "claimedUnitPriceCents": int(best["unitPriceCents"]),
                        }
                    )
            return {"lines": lines}

        if node == "justification":
            request = str(payload.get("request", ""))
            lines = payload.get("lines", [])
            parts = [f"{ln['qty']} x {ln['name']}" for ln in lines]
            total = sum(int(ln["qty"]) * int(ln["unitPriceCents"]) for ln in lines)
            text = (
                f"Requested: {request}. Order: {', '.join(parts)}; "
                f"total by catalog price ${total // 100:,}.{total % 100:02d}."
            )
            return {"justification": text[:2000]}

        raise ValueError(f"unknown node {node}")

    def _generate(
        self, messages: list[BaseMessage], stop: list[str] | None = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        system = str(messages[0].content)
        match = re.match(r"\[node:([a-z_]+)\]", system)
        if not match:
            raise ValueError("system message must start with [node:<name>]")
        payload = json.loads(str(messages[-1].content))
        text = json.dumps(self._answer(match.group(1), payload))
        n_in = _approx_tokens("".join(str(m.content) for m in messages))
        n_out = _approx_tokens(text)
        message = AIMessage(
            content=text,
            usage_metadata={"input_tokens": n_in, "output_tokens": n_out, "total_tokens": n_in + n_out},
        )
        return ChatResult(generations=[ChatGeneration(message=message)])


def make_model(name: str | None = None) -> BaseChatModel:
    name = name or os.environ.get("AGENT_MODEL", "scripted")
    if name == "scripted":
        return ScriptedChatModel()
    if name == "ollama":
        from langchain_ollama import ChatOllama

        return ChatOllama(
            model=os.environ.get("OLLAMA_MODEL", "qwen3.8:27b"),
            base_url=os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
            format="json",
            temperature=0,
            reasoning=False,
        )
    if name == "bedrock":
        model_id = os.environ.get("BEDROCK_MODEL_ID")
        if not model_id:
            raise ValueError("BEDROCK_MODEL_ID is required for AGENT_MODEL=bedrock")
        from langchain_aws import ChatBedrockConverse

        return ChatBedrockConverse(model=model_id)
    raise ValueError(f"unknown AGENT_MODEL {name}")
