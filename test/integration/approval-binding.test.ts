import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { monthOf } from '../../src/adapters/budgets-repo.js';
import { LocalDriver } from '../../src/local/driver.js';
import { startLocalEnv, type LocalEnv } from '../../src/local/env.js';
import { fixedOrderAgent } from '../../src/local/fixture-agent.js';
import { seedAll } from '../../src/local/seed.js';

describe.skipIf(process.env.DMA_INTEGRATION !== '1')('I1: the approval is bound to the proposal hash', () => {
  let env: LocalEnv;
  let driver: LocalDriver;
  beforeAll(async () => {
    env = await startLocalEnv({ agentClient: fixedOrderAgent([{ sku: 'GPU-DEVBOX-4090', qty: 3 }]) });
    await seedAll(env);
    driver = new LocalDriver(env);
  });
  afterAll(async () => { await env?.close(); });

  it('refuses to execute a proposal edited after approval was requested', async () => {
    const runId = await driver.startRun('U0REQUESTER', 'Three GPU boxes');
    await driver.waitForApproval(runId);
    await env.doc.send(new UpdateCommand({
      TableName: env.tables.runs,
      Key: { pk: `RUN#${runId}`, sk: 'PROPOSAL#v1' },
      UpdateExpression: 'SET #p.#l[0].qty = :q',
      ExpressionAttributeNames: { '#p': 'proposal', '#l': 'lines' },
      ExpressionAttributeValues: { ':q': 1 },
    }));
    await driver.click(runId, 'U0APPROVER1', 'approve');
    const meta = await driver.waitForStatus(runId, ['FAILED', 'DONE']);
    expect(meta.status).toBe('FAILED');
    expect(meta.failureReason).toBe('HashMismatch');
    expect(await env.ledger.get(runId)).toBeNull();
    const budget = await env.budgets.get('U0REQUESTER', monthOf(new Date().toISOString()));
    expect(budget!.spentCents).toBe(0);
  });
});
