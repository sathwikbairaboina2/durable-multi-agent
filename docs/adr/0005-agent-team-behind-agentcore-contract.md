# ADR 0005: Python LangGraph team behind the AgentCore HTTP contract, called through a Lambda shim

Status: accepted, 2026-10-04

## Decision

- The agent is a Python 3.12 LangGraph app. It is served with `BedrockAgentCoreApp` from `bedrock-agentcore` 1.24.0, which provides `GET /ping` and `POST /invocations`; this was prototyped on this host. The same container image would run on AgentCore Runtime. `app.run(port, host)` binds `127.0.0.1` unless `host="0.0.0.0"` is passed, and the container must pass it.
- **Routing is code; content is model.**
  - A deterministic supervisor function routes `intake → sourcing → justification → END`, based on which state fields are filled.
  - Each node asks the model for JSON and parses it with pydantic. On a validation error it retries once with the error appended (a schema-repair loop).
  - `with_structured_output` is not used. `GenericFakeChatModel` does not implement it (checked: "with_structured_output is not implemented for this model"). Plain JSON keeps the scripted, Ollama and Bedrock models on one code path.
- **The agent gets no AWS access.** The `invoke-agent` Lambda reads the active catalog and passes it in the payload `{ runId, request, catalog }`. The agent returns `{ proposal, usage }`.
- Budgets (I10): LangGraph `recursion_limit = 12`, plus a running sum of `usage_metadata.output_tokens`. Over 40,000 tokens, the run fails with `AgentBudgetExceeded`.
- Step Functions calls the agent through the `invoke-agent` Lambda. The Lambda picks one of two clients:
  - `HttpAgentClient` (`AGENT_URL`) locally;
  - `AgentCoreAgentClient` in AWS: `@aws-sdk/client-bedrock-agentcore` `InvokeAgentRuntimeCommand` with `AGENT_RUNTIME_ARN`. `runtimeSessionId` is `procurement-run-<runId>`, which is 42 characters (the API needs at least 33).

## What we gave up

- One extra Lambda hop (cost and latency), compared with a direct Step Functions SDK integration. SFN Local cannot run that integration anyway.
- `AgentCoreAgentClient` is only unit-tested with a mocked client. It has never called a real runtime.
- A model-driven supervisor (the design's "supervisor graph routes"). Deterministic routing is easier to test and keeps the model out of control flow.
