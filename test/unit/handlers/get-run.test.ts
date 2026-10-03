import { describe, expect, it } from 'vitest';
import { proposalHash } from '../../../src/core/hash.js';
import { makeGetRunHandler } from '../../../src/handlers/get-run.js';
import { FakeBudgets, FakeLedger, FakeRuns } from '../fakes.js';
import { RUN_ID, validOrder } from '../fixtures.js';

describe('get-run', () => {
  it('returns status, proposal and approval but never the task token', async () => {
    const runs = new FakeRuns();
    runs.seedRun(RUN_ID, 'U0REQ1', 'AWAITING_APPROVAL');
    await runs.putProposal(RUN_ID, { proposal: validOrder(), proposalHash: proposalHash(validOrder()), usage: { inputTokens: 0, outputTokens: 0, modelSteps: 0 } });
    runs.approvals.set(RUN_ID, {
      runId: RUN_ID, approvalId: 'A1', taskToken: 'SECRET-TOKEN-XYZ', proposalHash: 'h', totalCents: 5, pricedLines: [], state: 'PENDING', ttl: 1,
    });
    const h = makeGetRunHandler({ runs, ledger: new FakeLedger(runs, new FakeBudgets()) });
    const r = await h({ pathParameters: { runId: RUN_ID } });
    expect(r).toMatchObject({ statusCode: 200 });
    const body = (r as { body: string }).body;
    expect(body).not.toContain('SECRET-TOKEN-XYZ');
    expect(body).not.toContain('taskToken');
    expect(JSON.parse(body)).toMatchObject({ runId: RUN_ID, status: 'AWAITING_APPROVAL', approval: { approvalId: 'A1', state: 'PENDING', totalCents: 5 } });
  });
  it('returns 404 for an unknown or malformed run id', async () => {
    const runs = new FakeRuns();
    const h = makeGetRunHandler({ runs, ledger: new FakeLedger(runs, new FakeBudgets()) });
    expect(await h({ pathParameters: { runId: RUN_ID } })).toMatchObject({ statusCode: 404 });
    expect(await h({ pathParameters: { runId: 'nope' } })).toMatchObject({ statusCode: 404 });
    expect(await h({})).toMatchObject({ statusCode: 404 });
  });
});
