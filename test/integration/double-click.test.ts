import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDriver } from '../../src/local/driver.js';
import { startLocalEnv, type LocalEnv } from '../../src/local/env.js';
import { fixedOrderAgent } from '../../src/local/fixture-agent.js';
import { seedAll } from '../../src/local/seed.js';

describe.skipIf(process.env.DMA_INTEGRATION !== '1')('I7: an approval decides once', () => {
  let env: LocalEnv;
  let driver: LocalDriver;
  beforeAll(async () => {
    env = await startLocalEnv({ agentClient: fixedOrderAgent([{ sku: 'MONITOR-27-4K', qty: 1 }]) });
    await seedAll(env);
    driver = new LocalDriver(env);
  });
  afterAll(async () => { await env?.close(); });

  it('lets exactly one of two concurrent opposite clicks win, for 10 runs', async () => {
    const runIds = await Promise.all(Array.from({ length: 10 }, () => driver.startRun('U0REQUESTER', 'One monitor')));
    await Promise.all(runIds.map((id) => driver.waitForApproval(id)));

    const pairs = await Promise.all(runIds.map((id) => Promise.all([
      driver.click(id, 'U0APPROVER1', 'approve'),
      driver.click(id, 'U0APPROVER2', 'reject'),
    ])));

    let approved = 0;
    for (let i = 0; i < runIds.length; i++) {
      const texts = pairs[i]!.map((p) => p.text);
      const winners = texts.filter((t) => t === 'Approved. Placing the order.' || t === 'Rejected.');
      const losers = texts.filter((t) => t.startsWith('Already decided'));
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      const expected = winners[0] === 'Rejected.' ? 'REJECTED_BY_HUMAN' : 'DONE';
      const meta = await driver.waitForStatus(runIds[i]!, ['DONE', 'REJECTED_BY_HUMAN']);
      expect(meta.status).toBe(expected);
      if (expected === 'DONE') approved += 1;
    }
    const rows = (await Promise.all(runIds.map((id) => env.ledger.get(id)))).filter((r) => r !== null);
    expect(rows).toHaveLength(approved);
  });
});
