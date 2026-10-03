import { describe, expect, it } from 'vitest';
import { proposalHash } from '../../../src/core/hash.js';
import type { ApprovalState } from '../../../src/core/types.js';
import { makeExecutePoHandler } from '../../../src/handlers/execute-po.js';
import { FakeBudgets, FakeLedger, FakeRuns } from '../fakes.js';
import { RUN_ID, validOrder } from '../fixtures.js';

const NOW = '2026-10-04T10:00:00.000Z';

async function setup(opts: { limit?: number; spent?: number; approval?: ApprovalState } = {}) {
  const runs = new FakeRuns();
  runs.seedRun(RUN_ID, 'U0REQ1', 'AWAITING_APPROVAL');
  const h0 = proposalHash(validOrder());
  await runs.putProposal(RUN_ID, { proposal: validOrder(), proposalHash: h0, usage: { inputTokens: 0, outputTokens: 0, modelSteps: 0 } });
  runs.approvals.set(RUN_ID, {
    runId: RUN_ID, approvalId: 'A1', taskToken: 't', proposalHash: h0, totalCents: 869700, state: opts.approval ?? 'APPROVED',
    decidedBy: 'U0APPROVER1', pricedLines: [{ sku: 'GPU-DEVBOX-4090', name: 'GPU dev box (RTX 4090)', qty: 3, unitPriceCents: 289900, lineCents: 869700 }], ttl: 1,
  });
  const budgets = new FakeBudgets();
  await budgets.put({ requesterId: 'U0REQ1', month: '2026-10', limitCents: opts.limit ?? 1_500_000, spentCents: opts.spent ?? 0 });
  const ledger = new FakeLedger(runs, budgets);
  const h = makeExecutePoHandler({ runs, budgets, ledger, now: () => NOW });
  return { runs, budgets, ledger, h, event: { runId: RUN_ID, requesterId: 'U0REQ1' } };
}

describe('execute-po', () => {
  it('writes the ledger row once and charges the budget', async () => {
    const { runs, budgets, ledger, h, event } = await setup();
    expect(await h(event)).toEqual({ ledgerWritten: true, totalCents: 869700 });
    expect(ledger.rows.size).toBe(1);
    expect((await budgets.get('U0REQ1', '2026-10'))!.spentCents).toBe(869700);
    expect(runs.metas.get(RUN_ID)!.status).toBe('DONE');
  });

  it('retry after commit returns alreadyExecuted without a second charge (I4)', async () => {
    const { budgets, ledger, h, event } = await setup();
    await h(event);
    expect(await h(event)).toEqual({ alreadyExecuted: true, totalCents: 869700 });
    expect(ledger.rows.size).toBe(1);
    expect((await budgets.get('U0REQ1', '2026-10'))!.spentCents).toBe(869700);
  });

  it('I1: an edited stored proposal fails with HashMismatch and writes nothing', async () => {
    const { runs, ledger, h, event } = await setup();
    runs.proposals.get(RUN_ID)!.proposal.lines[0]!.qty = 4;
    await expect(h(event)).rejects.toMatchObject({ name: 'HashMismatch' });
    expect(ledger.rows.size).toBe(0);
  });

  it('I1: the stored hash field is not trusted', async () => {
    const { runs, ledger, h, event } = await setup();
    const p = runs.proposals.get(RUN_ID)!;
    p.proposal.lines[0]!.qty = 4;
    p.proposalHash = runs.approvals.get(RUN_ID)!.proposalHash;
    await expect(h(event)).rejects.toMatchObject({ name: 'HashMismatch' });
    expect(ledger.rows.size).toBe(0);
  });

  it('throws BudgetExhausted when the budget is too small', async () => {
    const { ledger, h, event } = await setup({ limit: 100 });
    await expect(h(event)).rejects.toMatchObject({ name: 'BudgetExhausted' });
    expect(ledger.rows.size).toBe(0);
  });

  it.each<ApprovalState>(['REJECTED', 'PENDING', 'EXPIRED'])('throws NotApproved for a %s approval', async (state) => {
    const { ledger, h, event } = await setup({ approval: state });
    await expect(h(event)).rejects.toMatchObject({ name: 'NotApproved' });
    expect(ledger.rows.size).toBe(0);
  });

  it('throws NotApproved when the run is not awaiting approval', async () => {
    const { runs, h, event } = await setup();
    runs.metas.get(RUN_ID)!.status = 'EXPIRED';
    await expect(h(event)).rejects.toMatchObject({ name: 'NotApproved' });
  });

  it('throws NotFound for an unknown run', async () => {
    const { h } = await setup();
    await expect(h({ runId: '01J9ZX5K3M8Q4R6T7V9W1Y2ZZZ', requesterId: 'U0REQ1' })).rejects.toMatchObject({ name: 'NotFound' });
  });
});
