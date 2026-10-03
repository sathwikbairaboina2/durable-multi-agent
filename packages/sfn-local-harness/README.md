# sfn-local-harness

Run the exact Step Functions state machine your CDK app synthesizes on AWS Step Functions Local, with your Lambda handlers running in-process. It resolves the CloudFormation intrinsics CDK emits, creates the DynamoDB tables in DynamoDB Local, and hosts a small Lambda Invoke API so the state machine's `lambda:invoke` tasks call your TypeScript functions directly. No LocalStack and no AWS account are needed.

```bash
npm install --save-dev sfn-local-harness
```

You need Docker for `amazon/aws-stepfunctions-local` (with `LAMBDA_ENDPOINT` pointing at the host) and `amazon/dynamodb-local`.

## Usage

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SFNClient } from '@aws-sdk/client-sfn';
import { readFileSync } from 'node:fs';
import {
  deployStateMachine, deployTables, loadStack, startLambdaHost,
  waitForDynamoDbLocal, waitForStepFunctionsLocal,
} from 'sfn-local-harness';

const template = JSON.parse(readFileSync('cdk.out/MyStack.template.json', 'utf8'));
const stack = loadStack(template, { prefix: 'run1' });

const ddb = new DynamoDBClient({ endpoint: 'http://127.0.0.1:5330', region: 'us-east-1' });
const sfn = new SFNClient({ endpoint: 'http://127.0.0.1:5332', region: 'us-east-1' });
await waitForDynamoDbLocal(ddb);
await waitForStepFunctionsLocal(sfn);

await deployTables(ddb, stack.tables);
const host = await startLambdaHost({
  port: 5331,
  resolve: (name) => myHandlers[name.replace(stack.prefix, '')], // your own lookup
});
const arn = await deployStateMachine(sfn, stack.stateMachines[0]!);
// sfn.send(new StartExecutionCommand({ stateMachineArn: arn, input: '{}' })) ...
await host.close();
```

## Supported CloudFormation intrinsics

`Ref` (including `AWS::Region`, `AWS::AccountId`, `AWS::Partition`, `AWS::URLSuffix`, `AWS::StackName`), `Fn::GetAtt` (array and string forms), `Fn::Join`, `Fn::Sub` (string form), `Fn::Select` and `Fn::Split`. Anything else, such as `Fn::ImportValue`, throws `Unsupported intrinsic <name>` instead of guessing.

## Known limits of Step Functions Local

It is an old, unsupported image: no JSONata, no redrive, no IAM evaluation, task tokens are 36-character UUIDs, and it answers with socket hang-ups for its first seconds (use `waitForStepFunctionsLocal`). The repository's ADR 0001 (`docs/adr/0001-*.md`) lists what was checked and what it gives up.
