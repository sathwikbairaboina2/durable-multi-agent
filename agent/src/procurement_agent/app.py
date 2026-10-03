import os

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from pydantic import ValidationError

from .graph import run_team
from .models import make_model
from .nodes import AgentBudgetExceeded, AgentOutputInvalid
from .schemas import Invocation

app = BedrockAgentCoreApp()


@app.entrypoint
def invoke(payload: dict) -> dict:
    try:
        invocation = Invocation.model_validate(payload)
        return run_team(invocation, make_model())
    except (AgentOutputInvalid, AgentBudgetExceeded, ValidationError) as e:
        return {"error": {"type": type(e).__name__, "message": str(e)}}


def main() -> None:
    app.run(port=int(os.environ.get("PORT", "8080")), host=os.environ.get("HOST", "0.0.0.0"))


if __name__ == "__main__":
    main()
