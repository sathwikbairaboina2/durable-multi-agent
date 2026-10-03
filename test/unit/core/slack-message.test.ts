import { describe, expect, it } from 'vitest';
import { buildApprovalMessage, buildOutcomeMessage, parseActionValue } from '../../../src/core/slack-message.js';
import type { PricedLine } from '../../../src/core/types.js';
import { RUN_ID } from '../fixtures.js';

const APPROVAL_ID = '01J9ZX5K3M8Q4R6T7V9W1Y2Z3B';
const pricedLines: PricedLine[] = [
  { sku: 'GPU-DEVBOX-4090', name: 'GPU dev box (RTX 4090)', qty: 3, unitPriceCents: 289900, lineCents: 869700 },
];
const input = (justification = 'ML team needs boxes.') => ({
  runId: RUN_ID, approvalId: APPROVAL_ID, requesterId: 'U0REQ1', pricedLines,
  totalCents: 869700, remainingBudgetCents: 630300, justification,
});

describe('buildApprovalMessage', () => {
  it('has total, requester and one actions block with two buttons', () => {
    const m = buildApprovalMessage(input());
    expect(m.text).toContain('$8,697.00');
    expect(m.text).toContain('<@U0REQ1>');
    const actions = (m.blocks as Array<{ type: string; elements?: Array<Record<string, unknown>> }>).filter((b) => b.type === 'actions');
    expect(actions).toHaveLength(1);
    const [a, r] = actions[0]!.elements!;
    expect(a).toMatchObject({ action_id: 'approve', style: 'primary', value: JSON.stringify({ a: APPROVAL_ID, d: 'approve' }) });
    expect(r).toMatchObject({ action_id: 'reject', style: 'danger', value: JSON.stringify({ a: APPROVAL_ID, d: 'reject' }) });
  });
  it('truncates a long justification', () => {
    const m = buildApprovalMessage(input('x'.repeat(5000)));
    const sections = (m.blocks as Array<{ type: string; text?: { text: string } }>).filter((b) => b.type === 'section' && b.text);
    const just = sections[sections.length - 1]!.text!.text;
    expect(just.length).toBeLessThanOrEqual(2900);
    expect(just.endsWith('…')).toBe(true);
  });
});

describe('parseActionValue', () => {
  it('parses a valid value', () => {
    expect(parseActionValue(JSON.stringify({ a: APPROVAL_ID, d: 'approve' }))).toEqual({ approvalId: APPROVAL_ID, decision: 'approve' });
  });
  it.each([
    ['bad id', '{"a":"x","d":"approve"}'],
    ['bad decision', JSON.stringify({ a: APPROVAL_ID, d: 'maybe' })],
    ['not json', 'not json'],
    ['extra key', JSON.stringify({ a: APPROVAL_ID, d: 'approve', x: 1 })],
  ])('rejects %s', (_n, v) => expect(parseActionValue(v)).toBeNull());
});

describe('buildOutcomeMessage', () => {
  it('has no actions block and a status-specific text', () => {
    const done = buildOutcomeMessage({ runId: RUN_ID, status: 'DONE', decidedBy: 'U0APPROVER1', totalCents: 869700 });
    expect((done.blocks as Array<{ type: string }>).some((b) => b.type === 'actions')).toBe(false);
    expect(done.text).toContain('Ordered');
    expect(buildOutcomeMessage({ runId: RUN_ID, status: 'REJECTED_BY_HUMAN' }).text).toContain('Rejected');
    expect(buildOutcomeMessage({ runId: RUN_ID, status: 'EXPIRED' }).text).toContain('Expired');
    expect(buildOutcomeMessage({ runId: RUN_ID, status: 'FAILED', reason: 'BUDGET_EXHAUSTED' }).text).toContain('budget');
  });
});
