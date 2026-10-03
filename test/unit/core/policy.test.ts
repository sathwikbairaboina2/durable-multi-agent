import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '../../../src/core/policy.js';
import type { Budget } from '../../../src/core/types.js';
import { catalogMap, validOrder } from '../fixtures.js';

const budget = (spentCents = 0): Budget => ({ requesterId: 'U0REQ1', month: '2026-10', limitCents: 1_500_000, spentCents });
const run = (proposal: unknown, b: Budget | null = budget()) =>
  evaluatePolicy({ proposal, catalog: catalogMap(), budget: b, maxOrderCents: 1_000_000 });
const withLines = (lines: unknown[]) => ({ ...validOrder(), lines });

describe('evaluatePolicy', () => {
  it('prices a valid order from the catalog, ignoring claimed prices', () => {
    const r = run(validOrder());
    expect(r.ok).toBe(true);
    expect(r.totalCents).toBe(869700);
    expect(r.pricedLines[0]).toEqual({ sku: 'GPU-DEVBOX-4090', name: 'GPU dev box (RTX 4090)', qty: 3, unitPriceCents: 289900, lineCents: 869700 });
    expect(r.remainingBudgetCents).toBe(630300);
  });
  it('rejects unknown sku', () => {
    expect(run(withLines([{ sku: 'NOPE-1', qty: 1 }])).reasons).toContain('unknown sku NOPE-1');
  });
  it('rejects inactive sku', () => {
    expect(run(withLines([{ sku: 'LAPTOP-13-OLD', qty: 1 }])).reasons).toContain('inactive sku LAPTOP-13-OLD');
  });
  it('rejects qty over max', () => {
    expect(run(withLines([{ sku: 'GPU-DEVBOX-4090', qty: 6 }])).reasons).toContain('qty 6 exceeds max 5 for GPU-DEVBOX-4090');
  });
  it('rejects duplicate skus', () => {
    const r = run(withLines([{ sku: 'GPU-DEVBOX-4090', qty: 1 }, { sku: 'GPU-DEVBOX-4090', qty: 1 }]));
    expect(r.reasons).toContain('duplicate sku GPU-DEVBOX-4090');
  });
  it('rejects totals over the cap', () => {
    const r = run(withLines([{ sku: 'GPU-DEVBOX-4090', qty: 4 }]));
    expect(r.reasons).toContain('order total $11,596.00 exceeds cap $10,000.00');
  });
  it('rejects a missing budget', () => {
    expect(run(validOrder(), null).reasons).toContain('no budget for this month');
  });
  it('allows spent + total == limit and rejects one cent over', () => {
    const ok = run(validOrder(), budget(630300));
    expect(ok.ok).toBe(true);
    expect(ok.remainingBudgetCents).toBe(0);
    const over = run(validOrder(), budget(630301));
    expect(over.ok).toBe(false);
    expect(over.reasons).toContain('order total $8,697.00 exceeds remaining budget $8,696.99');
  });
  it('fails closed on schema-invalid input', () => {
    const r = run(withLines([{ sku: 'GPU-DEVBOX-4090', qty: 0 }]));
    expect(r.ok).toBe(false);
    expect(r.totalCents).toBe(0);
    expect(r.pricedLines).toEqual([]);
    expect(r.reasons.every((x) => x.startsWith('schema:'))).toBe(true);
  });
});
