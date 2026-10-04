# Handoff log

## 2026-10-04, Claude (Opus lead, planning), branch main

- **Changed:** repo initialised. Spec, ADRs 0001-0008, the 25-task implementation plan and the SDD ledger are written. No code yet.
- **Decisions:** no LocalStack (no token). The synthesized state machine runs on Step Functions Local 2.0.0 and DynamoDB Local 3.3.1, with handlers in-process via `sfn-local-harness`. The headline is a measured chaos benchmark. The durable-functions variant moves to v0.2.
- **Left:** Tasks 1-25 of `docs/superpowers/plans/2026-10-04-durable-multi-agent.md`.
- **Verify:** read the plan's Gates table (G1-G10). Progress is in `.superpowers/sdd/2026-10-04-durable-multi-agent/progress.md`.

## 2026-10-04, Claude (Sonnet builder), branch main

- **Changed:** all 25 plan tasks. Deterministic core, DynamoDB repositories, nine handlers, one CDK stack (cdk-nag 3 acknowledgements), the `sfn-local-harness` package, the local environment on DynamoDB Local and Step Functions Local, unit, property, CDK and integration tests, the LangGraph agent and its container, `pa demo`, the chaos benchmark with committed results, CI, README and DEVDOCS.
- **Left:** the Ollama demo and eval were not completed (the host Ollama server crashed or ran out of memory while loading the model), so there is no model-quality number. v0.2 items are in ADR 0007. Review findings from the Opus lead are not applied yet.
- **Verify:** `npm ci`, `npm run typecheck`, `npm test`, `npm run synth`, `cd agent && uv sync --frozen && uv run pytest -q`, `npm run local:up && npm run test:integration && npm run local:down`, `npm run local:up && npm run bench -- --runs 200 && npm run local:down`, then check `bench/results/latest.json`. Gate results are in `.superpowers/sdd/2026-10-04-durable-multi-agent/progress.md` (Task 25).
