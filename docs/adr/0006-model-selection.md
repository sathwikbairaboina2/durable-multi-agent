# ADR 0006: Scripted model by default, Ollama opt-in, Bedrock wired but unrun

Status: accepted, 2026-10-04

## Context

On this host, `qwen3.8:27b` on Ollama took 123 s for a cold call and 11.1 s for a warm JSON-mode call. A three-node team is 30-60 s per run. A demo, CI and the benchmark cannot depend on that.

## Decision

- `AGENT_MODEL=scripted` (default): a deterministic fake chat model. It answers each node from the request text, using keyword rules over the catalog. For example, "GPU" maps to `GPU-DEVBOX-4090`, and the quantity is the first number in the request. Every output is clearly labelled "scripted".
- `AGENT_MODEL=ollama`: `ChatOllama(model=$OLLAMA_MODEL (default qwen3.8:27b), base_url=$OLLAMA_BASE_URL, format="json", temperature=0, reasoning=False)`.
- `AGENT_MODEL=bedrock`: `ChatBedrockConverse(model=$BEDROCK_MODEL_ID)`. There is no default model id; the factory raises an error if it is unset. Never run in v0.1.
- The benchmark does not call the agent at all. It injects a fixture `AgentClient` into `invoke-agent`, because it measures orchestration, not the model.

## What we gave up

- The default demo shows the plumbing, not model quality. Model quality is measured separately by the eval (`agent/evals`) on Ollama, and reported as its own number.
