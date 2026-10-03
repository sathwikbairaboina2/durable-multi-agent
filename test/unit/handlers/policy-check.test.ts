import { describe, expect, it } from 'vitest';
import { proposalHash } from '../../../src/core/hash.js';
import { makePolicyCheckHandler } from '../../../src/handlers/policy-check.js';
import { FakeBudgets, FakeCatalog, FakeRuns } from '../fakes.js';
import { CATALOG_ITEMS, RUN_ID, validOrder } from '../fixtures.js';

const setup = async (spentCents = 0) => {
  const runs = new FakeRuns();
  runs.seedRun(RUN_ID, 'U0REQ1', 'POLICY');
  await runs.putProposal(RUN_ID, { proposal: validOrder(), proposalHash: proposalHash(validOrder()), usage: { inputTokens: 0, outputTokens: 0, modelSteps: 0 } });
  const budgets = new FakeBudgets();
  await budgets.put({ requesterId: 'U0REQ1', month: '2026-10', limitCents: 1_500_000, spentCents });
  const h = makePolicyCheckHandler({
    runs, catalog: new FakeCatalog(CATALOG_ITEMS), budgets, maxOrderCents: 1_000_000, now: () => '2026-10-04T10:00:00.000Z',
  });
  return { h };
};

describe('policy-check', () => {
  it('passes a valid order with the catalog total', async () => {
    const { h } = await setup();
    const r = await h({ runId: RUN_ID, requesterId: 'U0REQ1' });
    expect(r.ok).toBe(true);
    expect(r.totalCents).toBe(869700);
  });
  it('fails an over-budget order with a reason', async () => {
    const { h } = await setup(1_000_000);
    const r = await h({ runId: RUN_ID, requesterId: 'U0REQ1' });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('exceeds remaining budget');
  });
  it('throws NotFound without a stored proposal', async () => {
    const h = makePolicyCheckHandler({
      runs: new FakeRuns(), catalog: new FakeCatalog(), budgets: new FakeBudgets(), maxOrderCents: 1, now: () => '2026-10-04',
    });
    await expect(h({ runId: RUN_ID, requesterId: 'U0REQ1' })).rejects.toMatchObject({ name: 'NotFound' });
  });
});
