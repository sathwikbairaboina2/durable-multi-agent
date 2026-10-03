import { SendTaskSuccessCommand } from '@aws-sdk/client-sfn';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { monthOf } from '../../src/adapters/budgets-repo.js';
import { StepFunctionsWorkflow } from '../../src/adapters/workflow.js';
import { LocalDriver } from '../../src/local/driver.js';
import { startLocalEnv, type Handler, type LocalEnv } from '../../src/local/env.js';
import { fixedOrderAgent } from '../../src/local/fixture-agent.js';
import { seedAll } from '../../src/local/seed.js';

const REQUESTER = 'U0REQUESTER';
const lines = [{ sku: 'MONITOR-27-4K', qty: 2 }];
const enabled = process.env.DMA_INTEGRATION === '1';

describe.skipIf(!enabled)('I4: exactly-once execution', () => {
  let env: LocalEnv;
  let driver: LocalDriver;
  beforeAll(async () => {
    env = await startLocalEnv({ agentClient: fixedOrderAgent(lines) });
    await seedAll(env);
    driver = new LocalDriver(env);
  });
  afterAll(async () => { await env?.close(); });

  it('a duplicate SendTaskSuccess after completion is rejected and changes nothing', async () => {
    const runId = await driver.startRun(REQUESTER, 'Two monitors');
    await driver.click(runId, 'U0APPROVER1', 'approve');
    await driver.waitForStatus(runId, ['DONE']);
    const approval = await env.runs.getApproval(runId);
    let err: Error | null = null;
    try {
      await env.sfn.send(new SendTaskSuccessCommand({ taskToken: approval!.taskToken, output: '{}' }));
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(['TaskTimedOut', 'TaskDoesNotExist']).toContain(err!.name);
    expect(await env.ledger.get(runId)).toMatchObject({ totalCents: 89800 });
  });

  it('a duplicate StartExecution with the same runId returns the same execution', async () => {
    const runId = await driver.startRun(REQUESTER, 'Two monitors again');
    const meta = await env.runs.getMeta(runId);
    const wf = new StepFunctionsWorkflow(env.sfn, env.stateMachineArn);
    const again = await wf.start(runId, { runId, requesterId: REQUESTER, request: 'Two monitors again' });
    expect(again).toBe(meta!.executionArn);
  });
});

describe.skipIf(!enabled)('I4: a crash after the ledger commit is retried safely', () => {
  let env: LocalEnv;
  let driver: LocalDriver;
  const crashed = new Set<string>();
  beforeAll(async () => {
    env = await startLocalEnv({
      agentClient: fixedOrderAgent(lines),
      wrapHandler: (name, h): Handler => {
        if (name !== 'execute-po') return h;
        return async (event) => {
          const result = await h(event);
          if (!crashed.has(event.runId)) {
            crashed.add(event.runId);
            throw Object.assign(new Error('chaos'), { name: 'ChaosError' });
          }
          return result;
        };
      },
    });
    await seedAll(env);
    driver = new LocalDriver(env);
  });
  afterAll(async () => { await env?.close(); });

  it('reaches DONE with one ledger row and one charge', async () => {
    const runId = await driver.startRun(REQUESTER, 'Two monitors, crash after commit');
    await driver.click(runId, 'U0APPROVER1', 'approve');
    await driver.waitForStatus(runId, ['DONE'], 90_000);

    const events = await driver.history(runId);
    const failures = events.filter((e) => e.type === 'LambdaFunctionFailed' || e.type === 'TaskFailed');
    expect(failures.length).toBeGreaterThanOrEqual(1);
    console.log('failed event types in history:', [...new Set(failures.map((e) => e.type))].join(', '));

    expect(crashed.has(runId)).toBe(true);
    const row = await env.ledger.get(runId);
    expect(row).not.toBeNull();
    const budget = await env.budgets.get(REQUESTER, monthOf(new Date().toISOString()));
    expect(budget!.spentCents).toBe(row!.totalCents);
    expect((await env.ledger.scanAll()).filter((r) => r.runId === runId)).toHaveLength(1);
  });
});
