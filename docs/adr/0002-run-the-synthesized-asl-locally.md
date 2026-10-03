# ADR 0002: Run the synthesized state machine locally through `sfn-local-harness`

Status: accepted, 2026-10-04

## Context

A hand-written "local version" of the workflow would drift from the CDK definition. Local tests would then prove nothing about what gets deployed. We want the local run to execute the exact `DefinitionString` that `cdk synth` produces.

## Decision

Build a small, publishable npm workspace package, `packages/sfn-local-harness`:

- `resolveIntrinsics(value, ctx)`: resolves these and throws on anything else, naming the intrinsic:
  - `Fn::Join`, `Fn::GetAtt` and `Fn::Sub` (string form);
  - `Ref` to resources, `AWS::Partition`, `AWS::Region`, `AWS::AccountId` and `AWS::URLSuffix`.
- `loadStack(template, { prefix })` returns:
  - the state machines, with resolved definition strings;
  - the Lambda functions, with a fake ARN `arn:aws:lambda:<region>:<account>:function:<prefix><logicalId>` and resolved environment variables;
  - the DynamoDB tables, as a `CreateTableInput` with physical name `<prefix><logicalId>`.

  A `Ref` to a table resolves to that same physical name, so a handler's `RUNS_TABLE` env var points at the local table.
- `startLambdaHost({ port, resolve })`: an HTTP server for `POST /2015-03-31/functions/{name}/invocations`. A thrown error becomes `X-Amz-Function-Error: Unhandled` with `{ errorType: err.name, errorMessage }`, and Step Functions treats that exactly like a Lambda error.
- `deployTables(ddb, tables)`, `deployStateMachine(sfn, name, definition)` and `waitForStepFunctionsLocal(sfn)`.

The app maps each function to its handler with an explicit environment variable: every Lambda in `FlowStack` and `ApiStack` sets `DMA_HANDLER=<handler-name>`. `src/local/env.ts` builds each in-process handler from that function's resolved environment (`fromEnv(env)`). Each handler therefore sees its own table names, as it would in AWS.

The CDK app has one stack, `DurableMultiAgentStack`, built from three constructs: `Data`, `Flow` and `Api`. The design had three stacks, but one stack means the template has no `Fn::ImportValue`, so `loadStack` reads one self-contained template. For `stage: "local"`, the stack uses `Code.fromInline` placeholders for Lambda code. Local synth therefore needs no bundling, and the handlers run in-process anyway.

## What we gave up

- One stack instead of three: no independent deploys of data and flow. That doesn't matter at this size.
- Only the intrinsics listed above are supported. A new intrinsic in the template fails loudly at load time.
- Local function names include the CDK logical ID hash, so logs show names like `ExecutePoFnA1B2C3D4`.
- One extra package of about 300 lines, compared with a hand-written local runner. In exchange, the tests run the definition that deploys.
