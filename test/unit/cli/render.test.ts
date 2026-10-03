import { describe, expect, it } from 'vitest';
import { renderCard } from '../../../cli/render.js';
import { buildApprovalMessage } from '../../../src/core/slack-message.js';
import { RUN_ID } from '../fixtures.js';

const msg = buildApprovalMessage({
  runId: RUN_ID,
  approvalId: '01J9ZX5K3M8Q4R6T7V9W1Y2Z3B',
  requesterId: 'U0REQ1',
  pricedLines: [{ sku: 'GPU-DEVBOX-4090', name: 'GPU dev box (RTX 4090)', qty: 3, unitPriceCents: 289900, lineCents: 869700 }],
  totalCents: 869700,
  remainingBudgetCents: 630300,
  justification: 'We need three more GPU dev boxes so the ML team can train the new ranking model without queueing for shared capacity.',
});

describe('renderCard', () => {
  const card = renderCard(msg);
  it('shows the lines, total, budget, justification and buttons', () => {
    expect(card).toContain('3 × GPU dev box (RTX 4090)');
    expect(card).toContain('$8,697.00');
    expect(card).toContain('$6,303.00');
    expect(card).toContain('@U0REQ1');
    expect(card).toContain('ranking model');
    expect(card).toContain('[ Approve ]  [ Reject ]');
  });
  it('is a box no wider than 66 characters', () => {
    for (const line of card.split('\n')) expect(line.length).toBeLessThanOrEqual(66);
    expect(card.startsWith('┌')).toBe(true);
    expect(card.trimEnd().endsWith('┘')).toBe(true);
  });
});
