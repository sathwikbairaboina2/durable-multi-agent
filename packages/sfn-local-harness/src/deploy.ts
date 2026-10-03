import {
  CreateTableCommand, ListTablesCommand, UpdateTimeToLiveCommand, type DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  CreateStateMachineCommand, DeleteStateMachineCommand, ListStateMachinesCommand, type SFNClient,
} from '@aws-sdk/client-sfn';
import type { LoadedTable } from './load-stack.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function poll(probe: () => Promise<unknown>, timeoutMs: number, what: string, hint: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  for (;;) {
    try {
      await probe();
      return;
    } catch (e) {
      last = e;
    }
    if (Date.now() >= deadline) {
      throw new Error(`${what} not reachable after ${timeoutMs} ms (${(last as Error)?.message ?? last}). ${hint}`);
    }
    await sleep(500);
  }
}

/** Step Functions Local answers with socket hang-ups for its first seconds, so poll instead of sleeping. */
export function waitForStepFunctionsLocal(sfn: SFNClient, timeoutMs = 60_000): Promise<void> {
  return poll(
    () => sfn.send(new ListStateMachinesCommand({})),
    timeoutMs,
    'Step Functions Local',
    'Start it with: npm run local:up',
  );
}

export function waitForDynamoDbLocal(ddb: DynamoDBClient, timeoutMs = 60_000): Promise<void> {
  return poll(
    () => ddb.send(new ListTablesCommand({})),
    timeoutMs,
    'DynamoDB Local',
    'Start it with: npm run local:up',
  );
}

export async function deployTables(ddb: DynamoDBClient, tables: LoadedTable[]): Promise<void> {
  for (const t of tables) {
    try {
      await ddb.send(new CreateTableCommand(t.createTableInput as never));
    } catch (e) {
      if ((e as { name?: string }).name !== 'ResourceInUseException') throw e;
    }
    if (t.ttlAttribute) {
      await ddb.send(new UpdateTimeToLiveCommand({
        TableName: t.name,
        TimeToLiveSpecification: { AttributeName: t.ttlAttribute, Enabled: true },
      }));
    }
  }
}

export async function deployStateMachine(
  sfn: SFNClient,
  sm: { name: string; definition: string; roleArn?: string },
): Promise<string> {
  const r = await sfn.send(new CreateStateMachineCommand({
    name: sm.name,
    definition: sm.definition,
    roleArn: sm.roleArn ?? 'arn:aws:iam::123456789012:role/sfn-local',
  }));
  return r.stateMachineArn!;
}

export async function deleteStateMachine(sfn: SFNClient, arn: string): Promise<void> {
  await sfn.send(new DeleteStateMachineCommand({ stateMachineArn: arn }));
}
