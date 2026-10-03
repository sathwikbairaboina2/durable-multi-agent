# ADR 0001: Local AWS emulation with Step Functions Local and DynamoDB Local, not LocalStack

Status: accepted, 2026-10-04

## Context

The design assumed LocalStack (Hobby plan) as the deploy and integration target. LocalStack 2026.03+ cannot start without `LOCALSTACK_AUTH_TOKEN`, and this machine has none. There are no AWS credentials either. The project's claims (exactly-once execution, budget never exceeded, bounded approval wait) are about Step Functions and DynamoDB semantics, so testing them only with mocks would prove little.

## Facts checked on this host (2026-10-04)

- `amazon/aws-stepfunctions-local:2.0.0` (pushed 2024-05-18, also `latest`) with `LAMBDA_ENDPOINT=http://host.docker.internal:5331` pointing at a Node HTTP server on the host:
  - `arn:aws:states:::lambda:invoke.waitForTaskToken` delivers `$$.Task.Token` to the Lambda and waits; `SendTaskSuccess` resumes it.
  - A second `SendTaskSuccess` with the same token fails with `TaskTimedOut`.
  - `StartExecution` with an existing name fails with `ExecutionAlreadyExists`.
  - `TimeoutSeconds: 3` on the wait task raises `States.Timeout`, which a `Catch` routes.
  - `SendTaskFailure(error: "HumanRejected")` is routed by a `Catch` on `HumanRejected`.
  - A Lambda response with header `X-Amz-Function-Error: Unhandled` and body `{"errorType":"BudgetExhausted",...}` is caught by `ErrorEquals: ["BudgetExhausted"]`. `Retry` on an error type re-invokes the function.
  - The definition that `aws-cdk-lib` 2.272.0 synthesizes for `LambdaInvoke` ran after resolving `Fn::Join`, `Fn::GetAtt` and `Ref AWS::Partition`. The test covered `payloadResponseOnly`, CDK's default Lambda retries, `WAIT_FOR_TASK_TOKEN`, `taskTimeout`, `addCatch` and `addRetry`.
  - Task tokens are 36-character UUIDs. For the first ~10 s after start, requests fail with "socket hang up".
- `amazon/dynamodb-local:3.3.1` (2026-07-31): 20 concurrent `TransactWriteItems` ran against a budget that fits 7. Each one was a ledger put with `attribute_not_exists` plus a budget update conditioned on `limitCents = :lim AND spentCents <= :maxBefore`. Exactly 7 committed. The other 13 were cancelled with `ConditionalCheckFailed` reasons, and `spentCents` ended equal to `limitCents`. A repeated run id was rejected.
- AWS SDK v3 (3.1146.0) honours `AWS_ENDPOINT_URL_SFN` and `AWS_ENDPOINT_URL_DYNAMODB`, so handler code needs no endpoint plumbing.

## Decision

- `docker-compose.yml` (project `durable-multi-agent`) runs two containers:
  - `durable-multi-agent-dynamodb`: `127.0.0.1:5330 → 8000`, flags `-inMemory -sharedDb`.
  - `durable-multi-agent-sfn`: `127.0.0.1:5332 → 8083`, `LAMBDA_ENDPOINT=http://host.docker.internal:5331`, and `extra_hosts: host.docker.internal:host-gateway` for Linux CI.
  - Images are pinned to `3.3.1` and `2.0.0`.
- Lambda handlers run in-process on the host behind a Lambda Invoke API server on port 5331 (ADR 0002).
- Integration tests and the benchmark need these two containers. They run with `npm run test:integration` and `npm run bench`. `npm test` needs no Docker.
- CI runs the same containers. They need no secret, so integration tests run on every push.

## What we gave up

- **Parity.** AWS no longer supports Step Functions Local, and the image has not changed since 2024. It has no JSONata, no redrive, no IAM enforcement, no execution-role checks and no `aws-sdk:*` integrations. The flow therefore uses only JSONPath and Lambda tasks. IAM is checked by CDK `Template` assertions instead (I12).
- **Lambda fidelity.** Handlers run in one Node process, not in Lambda sandboxes. There are no cold starts, no memory or timeout limits, and module state is shared. Latencies measured locally say nothing about AWS latencies, and the docs say so.
- **API Gateway, KMS and AgentCore are not emulated.** Their adapters are unit-tested with `aws-sdk-client-mock`, and their wiring is checked with `cdk synth`.
