import json
import re
from typing import Any, Callable

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from pydantic import BaseModel, ValidationError


class AgentOutputInvalid(Exception):
    """The model could not produce JSON that matches the node's schema."""


class AgentBudgetExceeded(Exception):
    """The run used more graph steps or output tokens than allowed. The message is 'steps' or 'tokens'."""


def extract_json(text: str) -> str:
    text = re.sub(r"```(?:json)?", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end < start:
        return text
    return text[start : end + 1]


def call_json(
    model: BaseChatModel,
    node: str,
    instructions: str,
    payload: dict[str, Any],
    schema_cls: type[BaseModel],
    extra_check: Callable[[Any], None] | None = None,
    max_repairs: int = 1,
) -> tuple[Any, dict[str, int]]:
    """Ask the model for JSON, validate it, and repair once. Returns (object, usage)."""
    system = f"[node:{node}] {instructions}\nReply with JSON only, matching this JSON Schema: {schema_cls.model_json_schema()}"
    messages: list[BaseMessage] = [SystemMessage(system), HumanMessage(json.dumps(payload))]
    usage = {"input_tokens": 0, "output_tokens": 0, "model_steps": 0}
    err: Exception | None = None
    for attempt in range(max_repairs + 1):
        reply = model.invoke(messages)
        meta = getattr(reply, "usage_metadata", None) or {}
        usage["input_tokens"] += int(meta.get("input_tokens", 0))
        usage["output_tokens"] += int(meta.get("output_tokens", 0))
        usage["model_steps"] += 1
        try:
            obj = schema_cls.model_validate_json(extract_json(str(reply.content)))
            if extra_check is not None:
                extra_check(obj)
            return obj, usage
        except (ValidationError, ValueError) as e:
            err = e
            if attempt < max_repairs:
                messages = [
                    *messages,
                    reply,
                    HumanMessage(f"Your JSON was invalid: {e}. Reply with corrected JSON only."),
                ]
    raise AgentOutputInvalid(f"{node}: {err}")
