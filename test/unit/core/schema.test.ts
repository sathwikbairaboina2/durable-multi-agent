import { describe, expect, it } from 'vitest';
import { validateProposedOrder } from '../../../src/core/schema.js';
import { validOrder } from '../fixtures.js';

const line = { sku: 'MONITOR-27-4K', qty: 1 };

function withoutJustification(): Record<string, unknown> {
  const o: Record<string, unknown> = { ...validOrder() };
  delete o.justification;
  return o;
}

describe('validateProposedOrder', () => {
  it('accepts a valid order', () => {
    expect(validateProposedOrder(validOrder()).ok).toBe(true);
  });

  const bad: Array<[string, unknown]> = [
    ['extra top-level property', { ...validOrder(), extra: 1 }],
    ['extra line property', { ...validOrder(), lines: [{ sku: 'A', qty: 1, hack: true }] }],
    ['qty 0', { ...validOrder(), lines: [{ sku: 'A', qty: 0 }] }],
    ['qty 51', { ...validOrder(), lines: [{ sku: 'A', qty: 51 }] }],
    ['qty 2.5', { ...validOrder(), lines: [{ sku: 'A', qty: 2.5 }] }],
    ['11 lines', { ...validOrder(), lines: Array.from({ length: 11 }, () => line) }],
    ['0 lines', { ...validOrder(), lines: [] }],
    ['missing justification', withoutJustification()],
    ['2001-char justification', { ...validOrder(), justification: 'x'.repeat(2001) }],
    ['EUR currency', { ...validOrder(), currency: 'EUR' }],
    ['bad runId', { ...validOrder(), runId: 'not-a-ulid' }],
    ['null', null],
    ['array', []],
  ];
  it.each(bad)('rejects %s', (_name, input) => {
    const r = validateProposedOrder(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
  });
});
