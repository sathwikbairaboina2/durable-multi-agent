import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '../../../src/core/policy.js';
import type { CatalogItem } from '../../../src/core/types.js';
import { RUN_ID } from '../fixtures.js';

const MAX_ORDER = 5_000_000;

const catalogArb = fc
  .uniqueArray(fc.integer({ min: 1, max: 500_000 }), { minLength: 1, maxLength: 8 })
  .map((prices) =>
    prices.map((p, i): CatalogItem => ({
      sku: `SKU-${i}`, name: `Item ${i}`, vendor: 'V', unitPriceCents: p, maxQtyPerOrder: 50, active: true,
    })),
  );

const scenarioArb = catalogArb.chain((items) =>
  fc.record({
    items: fc.constant(items),
    picks: fc.uniqueArray(fc.integer({ min: 0, max: items.length - 1 }), { minLength: 1, maxLength: Math.min(10, items.length) }),
    qtys: fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 10, maxLength: 10 }),
    claimed: fc.array(fc.option(fc.integer({ min: 0, max: 10_000_000 })), { minLength: 10, maxLength: 10 }),
    claimed2: fc.array(fc.option(fc.integer({ min: 0, max: 10_000_000 })), { minLength: 10, maxLength: 10 }),
    spent: fc.integer({ min: 0, max: 3_000_000 }),
    limit: fc.integer({ min: 0, max: 20_000_000 }),
  }),
);

function build(s: { picks: number[]; qtys: number[] }, claimed: Array<number | null>) {
  return {
    runId: RUN_ID,
    currency: 'USD',
    justification: 'prop',
    lines: s.picks.map((p, i) => {
      const line: Record<string, unknown> = { sku: `SKU-${p}`, qty: s.qtys[i]! };
      if (claimed[i] !== null && claimed[i] !== undefined) line.claimedUnitPriceCents = claimed[i];
      return line;
    }),
  };
}

describe('evaluatePolicy properties', () => {
  it('I2: total equals the sum of catalog prices times qty; claimed prices never matter', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const catalog = new Map(s.items.map((i) => [i.sku, i]));
        const budget = { requesterId: 'U', month: '2026-10', limitCents: s.limit, spentCents: s.spent };
        const a = evaluatePolicy({ proposal: build(s, s.claimed), catalog, budget, maxOrderCents: MAX_ORDER });
        const b = evaluatePolicy({ proposal: build(s, s.claimed2), catalog, budget, maxOrderCents: MAX_ORDER });
        const expected = s.picks.reduce((sum, p, i) => sum + catalog.get(`SKU-${p}`)!.unitPriceCents * s.qtys[i]!, 0);
        expect(a.totalCents).toBe(expected);
        expect(b.totalCents).toBe(a.totalCents);
        expect(b.ok).toBe(a.ok);
      }),
      { numRuns: 300 },
    );
  });

  it('ok implies the cap and the budget hold', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const catalog = new Map(s.items.map((i) => [i.sku, i]));
        const budget = { requesterId: 'U', month: '2026-10', limitCents: s.limit, spentCents: s.spent };
        const r = evaluatePolicy({ proposal: build(s, s.claimed), catalog, budget, maxOrderCents: MAX_ORDER });
        if (r.ok) {
          expect(r.totalCents).toBeLessThanOrEqual(MAX_ORDER);
          expect(budget.spentCents + r.totalCents).toBeLessThanOrEqual(budget.limitCents);
        }
      }),
      { numRuns: 300 },
    );
  });
});
