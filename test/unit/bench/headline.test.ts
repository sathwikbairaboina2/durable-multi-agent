import { describe, expect, it } from 'vitest';
import { formatHeadline } from '../../../bench/headline.js';

describe('formatHeadline', () => {
  it('formats a measured result', () => {
    const s = formatHeadline({
      config: { runs: 200 }, crashesInjected: 57, doubleClicks: 180, conflictingClicks: 20,
      ledgerStatusMismatches: 0, budgetDriftCents: 0, overspendCents: 0, measuredAt: '2026-10-04T12:00:00.000Z',
    });
    expect(s).toBe(
      '200 approval runs with 57 crashes injected after commit, 200 double clicks and a budget race: ' +
      '0 duplicate or missing purchase orders, $0.00 budget drift, $0.00 overspend ' +
      '(Step Functions Local + DynamoDB Local, 2026-10-04).',
    );
  });
  it('shows non-zero drift in dollars', () => {
    const s = formatHeadline({
      config: { runs: 1 }, crashesInjected: 0, doubleClicks: 1, conflictingClicks: 0,
      ledgerStatusMismatches: 2, budgetDriftCents: 12345, overspendCents: 50, measuredAt: '2026-10-04T00:00:00Z',
    });
    expect(s).toContain('$123.45 budget drift');
    expect(s).toContain('$0.50 overspend');
  });
});
