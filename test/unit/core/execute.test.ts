import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planExecution, type ExecutionInput } from '../../../src/core/execute.js';
import { proposalHash } from '../../../src/core/hash.js';
import type { ApprovalState, PricedLine } from '../../../src/core/types.js';
import { RUN_ID, validOrder } from '../fixtures.js';

const pricedLines: PricedLine[] = [
  { sku: 'GPU-DEVBOX-4090', name: 'GPU dev box (RTX 4090)', qty: 3, unitPriceCents: 289900, lineCents: 869700 },
];
const NOW = '2026-10-04T10:00:00.000Z';

function base(over: Partial<ExecutionInput> = {}): ExecutionInput {
  return {
    runId: RUN_ID,
    requesterId: 'U0REQ1',
    storedProposal: validOrder(),
    approval: { state: 'APPROVED', proposalHash: proposalHash(validOrder()), decidedBy: 'U0APPROVER1', totalCents: 869700, pricedLines },
    budget: { limitCents: 1_500_000, spentCents: 0 },
    nowIso: NOW,
    ...over,
  };
}

describe('planExecution', () => {
  it('plans a valid execution', () => {
    const p = planExecution(base());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.totalCents).toBe(869700);
    expect(p.maxSpentBeforeCents).toBe(630300);
    expect(p.limitCents).toBe(1_500_000);
    expect(p.ledgerEntry.approvedBy).toBe('U0APPROVER1');
    expect(p.ledgerEntry.createdAt).toBe(NOW);
    expect(p.ledgerEntry.proposalHash).toBe(proposalHash(validOrder()));
  });

  it('rejects when approval hash differs from proposal hash', () => {
    const mutated = validOrder();
    mutated.lines[0]!.qty = 4;
    const p = planExecution(base({ storedProposal: mutated }));
    expect(p).toMatchObject({ ok: false, error: 'HashMismatch' });
  });

  it('rejects a missing approval', () => {
    expect(planExecution(base({ approval: null }))).toMatchObject({ ok: false, error: 'NotApproved' });
  });

  it.each<ApprovalState>(['PENDING', 'REJECTED', 'EXPIRED'])('rejects approval state %s', (state) => {
    const b = base();
    const p = planExecution({ ...b, approval: { ...b.approval!, state } });
    expect(p).toMatchObject({ ok: false, error: 'NotApproved' });
  });

  it('budget edges', () => {
    expect(planExecution(base({ budget: null }))).toMatchObject({ ok: false, error: 'BudgetExhausted' });
    expect(planExecution(base({ budget: { limitCents: 1_500_000, spentCents: 630300 } })).ok).toBe(true);
    expect(planExecution(base({ budget: { limitCents: 1_500_000, spentCents: 630301 } }))).toMatchObject({ ok: false, error: 'BudgetExhausted' });
    expect(planExecution(base({ budget: { limitCents: 100, spentCents: 0 } }))).toMatchObject({ ok: false, error: 'BudgetExhausted' });
  });

  it('ok iff spent + total <= limit (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }), fc.integer({ min: 0, max: 10_000_000 }), fc.integer({ min: 0, max: 10_000_000 }),
        (limit, spent, total) => {
          const b = base();
          const p = planExecution({ ...b, budget: { limitCents: limit, spentCents: spent }, approval: { ...b.approval!, totalCents: total } });
          expect(p.ok).toBe(spent + total <= limit);
        },
      ),
      { numRuns: 300 },
    );
  });
});
