import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { proposalHash } from '../../../src/core/hash.js';
import { signSlackRequest } from '../../../src/core/slack-verify.js';
import { makeSlackInteractionsHandler } from '../../../src/handlers/slack-interactions.js';
import { FakeRuns, FakeWorkflow, NamedError } from '../fakes.js';
import { RUN_ID, validOrder } from '../fixtures.js';

const SECRET = 'test-signing-secret';
const NOW = '2026-10-04T10:00:00.000Z';
const NOW_S = Math.floor(Date.parse(NOW) / 1000);
const APPROVAL_ID = '01J9ZX5K3M8Q4R6T7V9W1Y2Z3B';
const TOKEN = 'tok-123';

function setup() {
  const runs = new FakeRuns();
  runs.seedRun(RUN_ID, 'U0REQ1', 'AWAITING_APPROVAL');
  runs.approvals.set(RUN_ID, {
    runId: RUN_ID, approvalId: APPROVAL_ID, taskToken: TOKEN, proposalHash: proposalHash(validOrder()), totalCents: 869700,
    pricedLines: [], state: 'PENDING', ttl: 1,
  });
  runs.lookups.set(APPROVAL_ID, RUN_ID);
  const workflow = new FakeWorkflow();
  const h = makeSlackInteractionsHandler({ runs, workflow, signingSecret: SECRET, approverIds: ['U0APPROVER1', 'U0REQ1'], now: () => NOW });
  runs.calls.length = 0;
  return { runs, workflow, h };
}

function click(opts: { user?: string; decision?: string; approvalId?: string; ts?: number; tamper?: boolean; b64?: boolean; type?: string; badValue?: string } = {}) {
  const payload = {
    type: opts.type ?? 'block_actions',
    user: { id: opts.user ?? 'U0APPROVER1' },
    actions: [{ action_id: opts.decision ?? 'approve', value: opts.badValue ?? JSON.stringify({ a: opts.approvalId ?? APPROVAL_ID, d: opts.decision ?? 'approve' }) }],
  };
  const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
  const ts = String(opts.ts ?? NOW_S);
  const sig = signSlackRequest(SECRET, ts, body);
  const sent = opts.tamper ? body.replace('U0APPROVER1', 'U0ATTACKER') : body;
  return {
    headers: { 'X-Slack-Request-Timestamp': ts, 'X-Slack-Signature': sig },
    body: opts.b64 ? Buffer.from(sent).toString('base64') : sent,
    isBase64Encoded: !!opts.b64,
  } as unknown as APIGatewayProxyEventV2;
}

const text = (r: unknown) => JSON.parse((r as { body: string }).body).text as string;

describe('slack-interactions', () => {
  it('I6: rejects a stale timestamp before touching any port', async () => {
    const { runs, workflow, h } = setup();
    const r = await h(click({ ts: NOW_S - 301 }));
    expect(r).toMatchObject({ statusCode: 401 });
    expect(runs.calls).toEqual([]);
    expect(workflow.succeeded).toEqual([]);
  });
  it('I6: rejects a tampered body before touching any port', async () => {
    const { runs, h } = setup();
    expect(await h(click({ tamper: true }))).toMatchObject({ statusCode: 401 });
    expect(runs.calls).toEqual([]);
  });
  it('rejects missing headers', async () => {
    const { runs, h } = setup();
    expect(await h({ headers: {}, body: 'payload=%7B%7D', isBase64Encoded: false } as unknown as APIGatewayProxyEventV2)).toMatchObject({ statusCode: 401 });
    expect(runs.calls).toEqual([]);
  });
  it('replies unsupported to non block_actions and garbage values, with no state change', async () => {
    const { runs, workflow, h } = setup();
    expect(text(await h(click({ type: 'view_submission' })))).toBe('Unsupported interaction.');
    expect(text(await h(click({ badValue: 'garbage' })))).toBe('Unsupported interaction.');
    expect(runs.approvals.get(RUN_ID)!.state).toBe('PENDING');
    expect(workflow.succeeded).toEqual([]);
  });
  it('replies unknown for an unknown approval id', async () => {
    const { h } = setup();
    expect(text(await h(click({ approvalId: '01J9ZX5K3M8Q4R6T7V9W1Y2Z3C' })))).toBe('Unknown approval.');
  });
  it('I5: blocks self approval without a CAS or workflow call', async () => {
    const { runs, workflow, h } = setup();
    expect(text(await h(click({ user: 'U0REQ1' })))).toBe('You cannot approve your own request.');
    expect(runs.calls).not.toContain('decideApproval');
    expect(workflow.succeeded).toEqual([]);
  });
  it('I5: blocks users who are not approvers', async () => {
    const { runs, h } = setup();
    expect(text(await h(click({ user: 'U0OTHER' })))).toBe('You are not an approver for this request.');
    expect(runs.approvals.get(RUN_ID)!.state).toBe('PENDING');
  });
  it('approve: CAS then SendTaskSuccess with the hash', async () => {
    const { runs, workflow, h } = setup();
    expect(text(await h(click()))).toBe('Approved. Placing the order.');
    expect(runs.approvals.get(RUN_ID)).toMatchObject({ state: 'APPROVED', decidedBy: 'U0APPROVER1' });
    expect(workflow.succeeded).toEqual([{ token: TOKEN, output: { decision: 'approve', approver: 'U0APPROVER1', proposalHash: proposalHash(validOrder()) } }]);
  });
  it('reject: CAS then SendTaskFailure HumanRejected', async () => {
    const { workflow, h } = setup();
    expect(text(await h(click({ decision: 'reject' })))).toBe('Rejected.');
    expect(workflow.failed[0]).toMatchObject({ token: TOKEN, error: 'HumanRejected' });
  });
  it('I7: a second click gets Already decided and no second workflow call', async () => {
    const { workflow, h } = setup();
    await h(click());
    expect(text(await h(click({ user: 'U0APPROVER1' })))).toBe('Already decided by <@U0APPROVER1>.');
    expect(workflow.succeeded).toHaveLength(1);
  });
  it('I7: when the CAS loses the race the reply says decided and no workflow call is made', async () => {
    const { runs, workflow, h } = setup();
    const real = runs.decideApproval.bind(runs);
    runs.decideApproval = async (...a) => {
      await real(a[0], a[1], 'REJECTED', 'U0OTHER', NOW);
      return real(...a);
    };
    expect(text(await h(click()))).toBe('Already decided by <@U0OTHER>.');
    expect(workflow.succeeded).toEqual([]);
  });
  it('replies expired for an expired approval', async () => {
    const { runs, h } = setup();
    runs.approvals.get(RUN_ID)!.state = 'EXPIRED';
    expect(text(await h(click()))).toBe('This request expired.');
  });
  it('replies expired when Step Functions says TaskTimedOut', async () => {
    const { workflow, h } = setup();
    workflow.succeedError = new NamedError('TaskTimedOut');
    expect(text(await h(click()))).toBe('This request expired.');
  });
  it('accepts a base64 body', async () => {
    const { workflow, h } = setup();
    expect(text(await h(click({ b64: true })))).toBe('Approved. Placing the order.');
    expect(workflow.succeeded).toHaveLength(1);
  });
});
