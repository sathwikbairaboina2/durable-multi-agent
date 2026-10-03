import { isUlid } from './ids.js';
import { formatCents } from './money.js';
import type { Decision, PricedLine } from './types.js';

export type SlackMessage = { text: string; blocks: unknown[] };

export interface ApprovalMessageInput {
  runId: string;
  approvalId: string;
  requesterId: string;
  pricedLines: PricedLine[];
  totalCents: number;
  remainingBudgetCents: number | null;
  justification: string;
}

const MAX_JUSTIFICATION = 2900;

function truncate(s: string): string {
  return s.length <= MAX_JUSTIFICATION ? s : `${s.slice(0, MAX_JUSTIFICATION - 1)}…`;
}

export function buildApprovalMessage(i: ApprovalMessageInput): SlackMessage {
  const remaining = i.remainingBudgetCents === null ? 'n/a' : formatCents(i.remainingBudgetCents);
  return {
    text: `Purchase request ${formatCents(i.totalCents)} from <@${i.requesterId}> needs approval`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Purchase order approval' } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Requester*\n<@${i.requesterId}>` },
          { type: 'mrkdwn', text: `*Run*\n${i.runId}` },
        ],
      },
      ...i.pricedLines.map((l) => ({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${l.qty} × ${l.name}* — ${formatCents(l.lineCents)}` },
      })),
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `Total ${formatCents(i.totalCents)} · budget left after this order ${remaining}` }],
      },
      { type: 'section', text: { type: 'mrkdwn', text: truncate(i.justification) } },
      {
        type: 'actions',
        elements: [
          {
            type: 'button', action_id: 'approve', style: 'primary',
            text: { type: 'plain_text', text: 'Approve' },
            value: JSON.stringify({ a: i.approvalId, d: 'approve' }),
          },
          {
            type: 'button', action_id: 'reject', style: 'danger',
            text: { type: 'plain_text', text: 'Reject' },
            value: JSON.stringify({ a: i.approvalId, d: 'reject' }),
          },
        ],
      },
    ],
  };
}

export function parseActionValue(value: string): { approvalId: string; decision: Decision } | null {
  let v: unknown;
  try {
    v = JSON.parse(value);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 2 || !keys.includes('a') || !keys.includes('d')) return null;
  if (!isUlid(o.a)) return null;
  if (o.d !== 'approve' && o.d !== 'reject') return null;
  return { approvalId: o.a, decision: o.d };
}

export interface OutcomeInput {
  runId: string;
  status: 'DONE' | 'REJECTED_BY_HUMAN' | 'EXPIRED' | 'FAILED' | 'REJECTED_BY_POLICY';
  decidedBy?: string;
  totalCents?: number;
  reason?: string;
}

export function buildOutcomeMessage(i: OutcomeInput): SlackMessage {
  const total = i.totalCents === undefined ? '' : ` ${formatCents(i.totalCents)}`;
  const by = i.decidedBy ? ` by <@${i.decidedBy}>` : '';
  let text: string;
  switch (i.status) {
    case 'DONE': text = `Ordered${total}${by}. Run ${i.runId}.`; break;
    case 'REJECTED_BY_HUMAN': text = `Rejected${by}. Run ${i.runId}.`; break;
    case 'EXPIRED': text = `Expired without a decision. Run ${i.runId}.`; break;
    case 'REJECTED_BY_POLICY': text = `Blocked by policy. Run ${i.runId}.`; break;
    case 'FAILED':
      text = i.reason === 'BUDGET_EXHAUSTED'
        ? `Not ordered: the monthly budget is exhausted. Run ${i.runId}.`
        : `Failed${i.reason ? ` (${i.reason})` : ''}. Run ${i.runId}.`;
      break;
  }
  return { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] };
}
