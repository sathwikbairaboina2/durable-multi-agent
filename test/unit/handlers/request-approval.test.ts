import { describe, expect, it } from 'vitest';
import { captureLogs } from '../../../src/adapters/log.js';
import { proposalHash } from '../../../src/core/hash.js';
import type { PolicyResult } from '../../../src/core/types.js';
import { makeRequestApprovalHandler } from '../../../src/handlers/request-approval.js';
import { FakeRuns, FakeSlack } from '../fakes.js';
import { RUN_ID, validOrder } from '../fixtures.js';

const TOKEN = 'TOKEN-abc123-must-not-leak';
const policy: PolicyResult = {
  ok: true, totalCents: 869700, remainingBudgetCents: 630300, reasons: [],
  pricedLines: [{ sku: 'GPU-DEVBOX-4090', name: 'GPU dev box (RTX 4090)', qty: 3, unitPriceCents: 289900, lineCents: 869700 }],
};

async function setup() {
  const runs = new FakeRuns();
  runs.seedRun(RUN_ID, 'U0REQ1', 'POLICY');
  await runs.putProposal(RUN_ID, { proposal: validOrder(), proposalHash: proposalHash(validOrder()), usage: { inputTokens: 0, outputTokens: 0, modelSteps: 0 } });
  const slack = new FakeSlack();
  const h = makeRequestApprovalHandler({ runs, slack, channel: 'C0APPROVALS', ttlSeconds: 259200, now: () => '2026-10-04T10:00:00.000Z' });
  const event = { taskToken: TOKEN, runId: RUN_ID, requesterId: 'U0REQ1', proposalHash: proposalHash(validOrder()), policy };
  return { runs, slack, h, event };
}

describe('request-approval', () => {
  it('stores the approval, posts the card and never leaks the task token (I11)', async () => {
    const cap = captureLogs();
    let r: { approvalId: string };
    const { runs, slack, h, event } = await setup();
    try {
      r = await h(event);
    } finally {
      cap.restore();
    }
    expect(JSON.stringify(slack.posted)).not.toContain('TOKEN-abc123');
    expect(cap.lines.join('\n')).not.toContain('TOKEN-abc123');
    expect(JSON.stringify(r)).not.toContain('TOKEN-abc123');
    expect(runs.approvals.get(RUN_ID)).toMatchObject({ taskToken: TOKEN, state: 'PENDING', approvalId: r.approvalId });
    expect(runs.metas.get(RUN_ID)).toMatchObject({ status: 'AWAITING_APPROVAL', slackTs: '1700000000.000100', slackChannel: 'C0APPROVALS' });
    expect(slack.posted[0]!.channel).toBe('C0APPROVALS');
    expect(runs.approvals.get(RUN_ID)!.ttl).toBe(Math.floor(Date.parse('2026-10-04T10:00:00.000Z') / 1000) + 259200);
  });

  it('rethrows a Slack failure after the approval is stored so the workflow task fails', async () => {
    const { slack, h, event } = await setup();
    slack.failPost = true;
    await expect(h(event)).rejects.toThrow('slack down');
  });

  it('a re-invocation replaces the pending approval with a fresh id', async () => {
    const { runs, h, event } = await setup();
    const a = await h(event);
    const b = await h(event);
    expect(a.approvalId).not.toBe(b.approvalId);
    expect(runs.approvals.get(RUN_ID)!.approvalId).toBe(b.approvalId);
  });
});
