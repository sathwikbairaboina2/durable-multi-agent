import { describe, expect, it } from 'vitest';
import { formatCents } from '../../../src/core/money.js';

describe('formatCents', () => {
  it('formats dollars and cents', () => {
    expect(formatCents(869700)).toBe('$8,697.00');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(-100)).toBe('-$1.00');
  });
});
