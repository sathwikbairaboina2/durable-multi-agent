import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IllegalTransition } from '../../../src/core/errors.js';
import { RUN_STATUSES, assertTransition, canTransition, isTerminal } from '../../../src/core/status.js';
import type { RunStatus } from '../../../src/core/types.js';

describe('status machine', () => {
  const legal: Array<[RunStatus, RunStatus]> = [
    ['PLANNING', 'POLICY'], ['POLICY', 'AWAITING_APPROVAL'], ['POLICY', 'REJECTED_BY_POLICY'],
    ['AWAITING_APPROVAL', 'EXECUTING'], ['AWAITING_APPROVAL', 'REJECTED_BY_HUMAN'], ['AWAITING_APPROVAL', 'EXPIRED'],
    ['EXECUTING', 'DONE'],
    ...RUN_STATUSES.filter((s) => !isTerminal(s)).map((s) => [s, 'FAILED'] as [RunStatus, RunStatus]),
  ];
  it.each(legal)('allows %s -> %s', (a, b) => expect(canTransition(a, b)).toBe(true));

  const illegal: Array<[RunStatus, RunStatus]> = [
    ['PLANNING', 'DONE'], ['POLICY', 'EXECUTING'], ['AWAITING_APPROVAL', 'DONE'], ['DONE', 'FAILED'], ['EXPIRED', 'EXECUTING'],
    ...RUN_STATUSES.map((s) => [s, s] as [RunStatus, RunStatus]),
  ];
  it.each(illegal)('forbids %s -> %s', (a, b) => expect(canTransition(a, b)).toBe(false));

  it('isTerminal is exact', () => {
    expect(RUN_STATUSES.filter(isTerminal).sort()).toEqual(['DONE', 'EXPIRED', 'FAILED', 'REJECTED_BY_HUMAN', 'REJECTED_BY_POLICY']);
  });

  it('assertTransition throws IllegalTransition', () => {
    expect(() => assertTransition('DONE', 'FAILED')).toThrow(IllegalTransition);
    expect(() => assertTransition('DONE', 'FAILED')).toThrow('DONE -> FAILED');
  });

  it('random walks respect the table, terminals absorb, DONE only via EXECUTING', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...RUN_STATUSES), { maxLength: 20 }), (targets) => {
        let cur: RunStatus = 'PLANNING';
        let terminalReached = false;
        for (const t of targets) {
          if (canTransition(cur, t)) {
            expect(terminalReached).toBe(false);
            if (t === 'DONE') expect(cur).toBe('EXECUTING');
            cur = t;
            if (isTerminal(cur)) terminalReached = true;
          }
        }
        if (terminalReached) expect(isTerminal(cur)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
