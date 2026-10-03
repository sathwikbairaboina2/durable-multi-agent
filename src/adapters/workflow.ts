import {
  SendTaskFailureCommand, SendTaskSuccessCommand, StartExecutionCommand, type SFNClient,
} from '@aws-sdk/client-sfn';

export interface WorkflowPort {
  start(runId: string, input: object): Promise<string>;
  succeed(taskToken: string, output: object): Promise<void>;
  fail(taskToken: string, error: string, cause: string): Promise<void>;
}

const NO_RETRY = new Set(['TaskTimedOut', 'TaskDoesNotExist', 'InvalidToken']);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, backoffMs: number[] = [100, 200]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const name = (e as { name?: string }).name ?? '';
      if (NO_RETRY.has(name) || attempt >= backoffMs.length) throw e;
      await sleep(backoffMs[attempt]!);
    }
  }
}

export class StepFunctionsWorkflow implements WorkflowPort {
  constructor(private readonly client: SFNClient, private readonly stateMachineArn: string, private readonly backoffMs?: number[]) {}

  async start(runId: string, input: object): Promise<string> {
    try {
      const r = await this.client.send(new StartExecutionCommand({
        stateMachineArn: this.stateMachineArn, name: runId, input: JSON.stringify(input),
      }));
      return r.executionArn!;
    } catch (e) {
      if ((e as { name?: string }).name === 'ExecutionAlreadyExists') {
        return `${this.stateMachineArn.replace(':stateMachine:', ':execution:')}:${runId}`;
      }
      throw e;
    }
  }

  async succeed(taskToken: string, output: object): Promise<void> {
    await withRetry(() => this.client.send(new SendTaskSuccessCommand({ taskToken, output: JSON.stringify(output) })), this.backoffMs);
  }

  async fail(taskToken: string, error: string, cause: string): Promise<void> {
    await withRetry(() => this.client.send(new SendTaskFailureCommand({ taskToken, error, cause })), this.backoffMs);
  }
}
