# ADR 0007: v0.1 ships the Step Functions engine only; durable functions and AgentStack wait

Status: accepted, 2026-10-04

## Context

The design's headline was "Step Functions vs Lambda durable functions, cost per run over the same 50 requests". That needs billed duration and state-transition billing from a real AWS account. This machine has neither AWS credentials nor LocalStack. The ServerlessAgent construct that the design wants to reuse has no commits yet.

## Decision

- v0.1 is the design's v0.1 milestone list: the Step Functions engine, the deterministic core, approvals, local integration, the CLI and the README. It adds the chaos benchmark as the headline and `sfn-local-harness` as the installable piece.
- These move to v0.2:
  - Variant B (`@aws/durable-execution-sdk-js`, 2.6.0 on npm) and `pa compare`;
  - `AgentStack` on the ServerlessAgent construct;
  - reject-and-revise;
  - the Slack app manifest.
- `core/` keeps no orchestration logic, so variant B can reuse it unchanged.

## What we gave up

- "Built twice, measured not argued" is a v0.2 promise, not a v0.1 fact. The README says so in its roadmap section.
- The headline is about correctness under failure, which can be measured locally. It is not about AWS cost, which would have to be estimated.
