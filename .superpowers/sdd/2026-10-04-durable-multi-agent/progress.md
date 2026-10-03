# Ledger: durable-multi-agent v0.1

Plan: docs/superpowers/plans/2026-10-04-durable-multi-agent.md (25 tasks)
Spec: docs/superpowers/specs/2026-10-04-durable-multi-agent.md
ADRs: docs/adr/0001-0008
Commits: local commits authorized (no push, no remotes).

Planning (Opus, 2026-10-04): complete. Prototypes run on this host (not in repo): SFN Local 2.0.0 waitForTaskToken/SendTaskSuccess/duplicate token TaskTimedOut/duplicate start ExecutionAlreadyExists/TimeoutSeconds->States.Timeout/SendTaskFailure catch/Lambda errorType catch/CDK 2.272.0 synthesized ASL after intrinsic resolution; DynamoDB Local 3.3.1 20 concurrent budget transactions -> 7 committed, 13 ConditionalCheckFailed; bedrock-agentcore 1.24.0 /ping + /invocations; Ollama qwen3.8:27b JSON call 123 s cold, 11.1 s warm; GenericFakeChatModel lacks with_structured_output; ajv named import Ajv2020 typechecks under NodeNext; aws-sdk-client-mock 4.1.0 works with client-sfn 3.1146.0; Slack signing fixture verified.
Ruling: LocalStack not used (no auth token) - SFN Local + DynamoDB Local + in-process Lambda host instead (ADR 0001) - no IAM/JSONata/redrive parity locally
Ruling: one CDK stack with Data/Flow/Api constructs instead of three stacks - harness loads one template without Fn::ImportValue (ADR 0002) - no independent stack deploys
Ruling: durable-functions variant, AgentStack, revise loop deferred to v0.2 - no AWS billing data or ServerlessAgent commits available (ADR 0007) - headline is the chaos benchmark, not SFN-vs-durable cost
Task 1: complete (npm test -> 4 passed; typecheck exit 0) | commit: "chore: scaffold TypeScript project with pinned dependencies"
Ruling: a foreign session (its ledger line said "pnpm synth", AppSync, Cognito: not this project) ran git add -A + commit inside this repo at 04:15:31 and swept Task 2 files into commit 81ba3fd "feat(infra): gate synth with cdk-nag..." and added a bogus "Task 15" ledger line (removed) - cannot rewrite history (no amend) - Task 2 files live in 81ba3fd under the wrong subject; builder now commits with explicit paths
Task 2: complete (npm test -> 25 passed; typecheck exit 0) | commit: 81ba3fd (mis-attributed, see Ruling)
Task 3: complete (npm test -> 92 passed (11 files, tasks 3-6 combined run); typecheck exit 0) | commit: "feat(core): price proposals from the catalog and enforce caps and budget"
Task 4: complete (npm test 92 passed; typecheck 0) | commit: "feat(core): add run status machine and approver authorization"
Task 5: complete (npm test 92 passed; typecheck 0) | commit: "feat(core): verify Slack signatures and build approval messages"
Task 6: complete (npm test 92 passed; typecheck 0) | commit: "feat(core): plan purchase order execution bound to the approved proposal hash"
Ruling: second stray ledger line from a sibling session (infra-agent) removed; cause was both sessions using /tmp/done.sh - builder scripts moved to a private scratchpad - none
Task 7: complete (npm test -> 109 passed (15 files); typecheck exit 0) | commit: "feat(adapters): add DynamoDB repositories with transactional ledger execution"
Task 8: complete (npm test -> 135 passed (20 files); typecheck exit 0) | commit: "feat(handlers): start runs, invoke the agent team, persist and price proposals"
Task 9: complete (npm test -> 161 passed (24 files); typecheck exit 0) | commit: "feat(handlers): request Slack approval and resume the workflow on verified clicks"
Task 10: complete (npm test -> 179 passed (27 files); typecheck exit 0) | commit: "feat(handlers): execute purchase orders idempotently and finalize run outcomes"
Task 11: complete (npm test -> 190 passed (29 files); harness build exit 0; typecheck exit 0) | commit: "feat(harness): resolve CloudFormation intrinsics and load stacks for Step Functions Local"
Task 12: complete (npm test -> 196 passed (30 files); typecheck 0; npm pack --dry-run lists dist/**, README.md, LICENSE, package.json only) | commit: "feat(harness): host Lambda handlers in-process for Step Functions Local"
Task 13: complete (npm test -> 201 passed (31 files); typecheck exit 0) | commit: "feat(infra): add CDK stack with encrypted, point-in-time-recoverable tables"
Task 14: complete (npm test -> 210 passed (32 files); typecheck exit 0) | commit: "feat(infra): define the procurement state machine with task-token approval and bounded wait"
Ruling: cdk-nag 3.0.2 replaced Aspects/NagSuppressions with CDK policy validation (Validations.of(...).addPlugins/acknowledge) - used the v3 API and granular IAM acknowledgement ids, nag test asserts synth throws without them - plan snippets for v2 API were not applicable - none
Ruling: SlackInteractionsFn also gets STATE_MACHINE_ARN and get-run fromEnv no longer requires BUDGETS_TABLE - handler fromEnv needs them - none
Task 15: complete (npm test -> 216 passed (34 files); typecheck 0; npm run synth exit 0, bundled 9 handlers, no AwsSolutions errors, template has 59 resources) | commit: "feat(infra): expose the HTTP API and enforce least-privilege IAM with cdk-nag"
Task 16: complete (npm test -> 217 passed (35 files); typecheck 0; local:up + integration env.test.ts -> 3 passed; 2 containers durable-multi-agent-*) | commit: "feat(local): run the synthesized stack on DynamoDB Local and Step Functions Local"
Task 17: complete (integration flow.test.ts -> 6 passed (approve, reject, policy, invalid output, self-approval, expiry)) | commit: "test(integration): cover approve, reject, policy, invalid output, self-approval and expiry flows"
Task 18: complete (npm run test:integration -> 6 files, 15 passed, 0 skipped (binding 1, double-click 1, duplicate-resume 3, budget-race 1: 7 DONE / 13 BUDGET_EXHAUSTED, spent == sum ledger)) | commit: "test(integration): prove approval binding, single decision, exactly-once execution and budget race"
Task 19: complete (cd agent && uv run pytest -q -> 18 passed) | commit: "feat(agent): add schemas and scripted, Ollama and Bedrock model factory"
Task 20: complete (agent pytest -> 28 passed; docker compose build/up agent; /ping Healthy; /invocations -> GPU-DEVBOX-4090 qty 3 (model scripted)) | commit: "feat(agent): add LangGraph procurement team behind the AgentCore HTTP contract"
