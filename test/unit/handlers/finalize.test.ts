import { describe, expect, it } from 'vitest';
import { makeFinalizeHandler } from '../../../src/handlers/finalize.js';
import { FakeRuns, FakeSlack } from '../fakes.js';
import { RUN_ID } from '../fixtures.js';

function setup(status: Parameters<FakeRuns['seedRun']>[2]) {
  const runs = new FakeRuns();
  const meta = runs.seedRun(RUN_ID, 'U0REQ1', status);
  meta.slackTs = '1.2';
  meta.slackChannel = 'C1';
  const slack = new FakeSlack();
  return { runs, slack, h: makeFinalizeHandler({ runs, slack, now: () => 'now' }) };
}

describe('finalize', () => {
  it('moves EXECUTING to FAILED with a BUDGET_EXHAUSTED reason and updates Slack', async () => {
    const { runs, slack, h } = setup('EXECUTING');
    expect(await h({ runId: RUN_ID, outcome: 'FAILED', error: { Error: 'BudgetExhausted' } })).toEqual({ status: 'FAILED' });
    expect(runs.metas.get(RUN_ID)!.failureReason).toBe('BUDGET_EXHAUSTED');
    expect(slack.updated[0]!.text).toContain('budget');
  });
  it('is idempotent', async () => {
    const { slack, h } = setup('AWAITING_APPROVAL');
    await h({ runId: RUN_ID, outcome: 'REJECTED_BY_HUMAN' });
    expect(await h({ runId: RUN_ID, outcome: 'REJECTED_BY_HUMAN' })).toEqual({ status: 'REJECTED_BY_HUMAN' });
    expect(slack.updated.length).toBeGreaterThanOrEqual(1);
  });
  it('keeps DONE when finalize is called with FAILED', async () => {
    const { runs, h } = setup('DONE');
    expect(await h({ runId: RUN_ID, outcome: 'FAILED', error: { Error: 'States.TaskFailed' } })).toEqual({ status: 'DONE' });
    expect(runs.metas.get(RUN_ID)!.failureReason).toBeUndefined();
  });
  it('EXPIRED expires the pending approval first', async () => {
    const { runs, h } = setup('AWAITING_APPROVAL');
    runs.approvals.set(RUN_ID, {
      runId: RUN_ID, approvalId: 'A1', taskToken: 't', proposalHash: 'h', totalCents: 1, pricedLines: [], state: 'PENDING', ttl: 1,
    });
    expect(await h({ runId: RUN_ID, outcome: 'EXPIRED' })).toEqual({ status: 'EXPIRED' });
    expect(runs.calls).toContain('expireApproval');
    expect(runs.approvals.get(RUN_ID)!.state).toBe('EXPIRED');
  });
  it('REJECTED_BY_POLICY from POLICY', async () => {
    const { h } = setup('POLICY');
    expect(await h({ runId: RUN_ID, outcome: 'REJECTED_BY_POLICY' })).toEqual({ status: 'REJECTED_BY_POLICY' });
  });
  it('falls back to FAILED when the target is unreachable', async () => {
    const { runs, h } = setup('EXECUTING');
    expect(await h({ runId: RUN_ID, outcome: 'EXPIRED' })).toEqual({ status: 'FAILED' });
    expect(runs.metas.get(RUN_ID)!.failureReason).toContain('EXPIRED_UNREACHABLE');
  });
  it('does not throw when Slack fails', async () => {
    const { slack, h } = setup('EXECUTING');
    slack.failUpdate = true;
    await expect(h({ runId: RUN_ID, outcome: 'DONE' })).resolves.toEqual({ status: 'DONE' });
  });
});
