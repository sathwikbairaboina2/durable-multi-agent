import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { monthOf } from '../../src/adapters/budgets-repo.js';
import { LocalDriver } from '../../src/local/driver.js';
import { startLocalEnv, type LocalEnv } from '../../src/local/env.js';
import { fixedOrderAgent } from '../../src/local/fixture-agent.js';
import { seedAll, seedBudget } from '../../src/local/seed.js';

describe.skipIf(process.env.DMA_INTEGRATION !== '1')('I3: spend never exceeds the limit under concurrency', () => {
  let env: LocalEnv;
  let driver: LocalDriver;
  beforeAll(async () => {
    env = await startLocalEnv({ agentClient: fixedOrderAgent([{ sku: 'MONITOR-27-4K', qty: 1 }]) });
    await seedAll(env);
    await seedBudget(env.budgets, 'U0RACE', 7 * 44_900);
    driver = new LocalDriver(env);
  });
  afterAll(async () => { await env?.close(); });

  it('commits exactly the 7 orders that fit and fails the other 13 with BUDGET_EXHAUSTED', async () => {
    const runIds = await Promise.all(Array.from({ length: 20 }, () => driver.startRun('U0RACE', 'One monitor')));
    await Promise.all(runIds.map((id) => driver.waitForApproval(id)));
    await Promise.all(runIds.map((id) => driver.click(id, 'U0APPROVER1', 'approve')));
    const metas = await Promise.all(runIds.map((id) => driver.waitForStatus(id, ['DONE', 'FAILED'], 120_000)));

    const done = metas.filter((m) => m.status === 'DONE');
    const failed = metas.filter((m) => m.status === 'FAILED');
    expect(done).toHaveLength(7);
    expect(failed).toHaveLength(13);
    for (const m of failed) expect(m.failureReason).toBe('BUDGET_EXHAUSTED');

    const rows = (await Promise.all(runIds.map((id) => env.ledger.get(id)))).filter((r) => r !== null);
    expect(rows).toHaveLength(7);
    const budget = await env.budgets.get('U0RACE', monthOf(new Date().toISOString()));
    expect(budget!.spentCents).toBe(7 * 44_900);
    expect(budget!.spentCents).toBe(rows.reduce((s, r) => s + r!.totalCents, 0));
  });
});
