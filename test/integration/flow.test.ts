import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProposalLine } from '../../src/core/types.js';
import { monthOf } from '../../src/adapters/budgets-repo.js';
import { LocalDriver } from '../../src/local/driver.js';
import { startLocalEnv, type LocalEnv } from '../../src/local/env.js';
import { functionAgent } from '../../src/local/fixture-agent.js';
import { seedAll } from '../../src/local/seed.js';

const REQUESTER = 'U0REQUESTER';
const month = () => monthOf(new Date().toISOString());
const gpu = (qty: number): ProposalLine[] => [{ sku: 'GPU-DEVBOX-4090', qty }];
const usage = { inputTokens: 0, outputTokens: 0, modelSteps: 0 };

describe.skipIf(process.env.DMA_INTEGRATION !== '1')('flows on the synthesized state machine', () => {
  let env: LocalEnv;
  let driver: LocalDriver;
  let proposalLines: unknown[] = gpu(3);

  beforeAll(async () => {
    env = await startLocalEnv({
      agentClient: functionAgent((i) => ({
        proposal: { runId: i.runId, currency: 'USD', lines: proposalLines, justification: 'Fixture order.' },
        usage, model: 'fixture',
      })),
    });
    await seedAll(env);
    driver = new LocalDriver(env);
  });
  afterAll(async () => { await env?.close(); });

  const spent = async () => (await env.budgets.get(REQUESTER, month()))!.spentCents;
  const postsFor = (runId: string) => env.slack.posts().filter((p) => JSON.stringify(p.body).includes(runId));
  const updatesFor = (runId: string) => env.slack.updates().filter((p) => JSON.stringify(p.body.text ?? '').includes(runId));

  it('approve: posts a card, writes the ledger once, charges the budget, updates Slack', async () => {
    proposalLines = gpu(3);
    const before = await spent();
    const runId = await driver.startRun(REQUESTER, 'Three GPU dev boxes for the ML team');
    await driver.waitForApproval(runId);
    expect(postsFor(runId)).toHaveLength(1);
    expect(JSON.stringify(postsFor(runId)[0]!.body)).toContain('$8,697.00');

    const r = await driver.click(runId, 'U0APPROVER1', 'approve');
    expect(r.text).toBe('Approved. Placing the order.');
    await driver.waitForStatus(runId, ['DONE']);

    const row = await env.ledger.get(runId);
    expect(row).toMatchObject({ totalCents: 869700, approvedBy: 'U0APPROVER1' });
    expect((await spent()) - before).toBe(869700);
    const deadline = Date.now() + 10_000;
    while (updatesFor(runId).length === 0 && Date.now() < deadline) await new Promise((r2) => setTimeout(r2, 100));
    expect(updatesFor(runId)).toHaveLength(1);
    expect(updatesFor(runId)[0]!.body.text).toContain('Ordered');

    const got = await driver.getRun(runId);
    expect(got.statusCode).toBe(200);
    expect(got.raw).not.toContain('taskToken');
  });

  it('reject: ends REJECTED_BY_HUMAN with no ledger row and no spend', async () => {
    proposalLines = gpu(2);
    const before = await spent();
    const runId = await driver.startRun(REQUESTER, 'Two GPU boxes');
    expect((await driver.click(runId, 'U0APPROVER1', 'reject')).text).toBe('Rejected.');
    await driver.waitForStatus(runId, ['REJECTED_BY_HUMAN']);
    expect(await env.ledger.get(runId)).toBeNull();
    expect(await spent()).toBe(before);
  });

  it('policy rejection: an over-cap order never reaches Slack', async () => {
    proposalLines = gpu(4); // 4 x 289,900 = 1,159,600 > 1,000,000 cap
    const runId = await driver.startRun(REQUESTER, 'Four GPU boxes');
    await driver.waitForStatus(runId, ['REJECTED_BY_POLICY']);
    expect(postsFor(runId)).toHaveLength(0);
  });

  it('I9: invalid agent output fails the run before policy or Slack', async () => {
    proposalLines = [{ sku: 'GPU-DEVBOX-4090', qty: 0 }];
    const before = await spent();
    const runId = await driver.startRun(REQUESTER, 'Broken agent output');
    const meta = await driver.waitForStatus(runId, ['FAILED']);
    expect(meta.failureReason).toBe('InvalidProposal');
    expect(postsFor(runId)).toHaveLength(0);
    expect(await env.ledger.get(runId)).toBeNull();
    expect(await spent()).toBe(before);
  });

  it('I5: the requester cannot approve their own request; an approver then can', async () => {
    proposalLines = gpu(1);
    const runId = await driver.startRun(REQUESTER, 'One GPU box');
    const self = await driver.click(runId, REQUESTER, 'approve');
    expect(self.text).toBe('You cannot approve your own request.');
    expect((await env.runs.getMeta(runId))!.status).toBe('AWAITING_APPROVAL');
    expect((await driver.click(runId, 'U0APPROVER2', 'approve')).text).toBe('Approved. Placing the order.');
    await driver.waitForStatus(runId, ['DONE']);
  });
});

describe.skipIf(process.env.DMA_INTEGRATION !== '1')('approval expiry', () => {
  let env: LocalEnv;
  let driver: LocalDriver;

  beforeAll(async () => {
    env = await startLocalEnv({
      approvalTimeoutSeconds: 3,
      agentClient: functionAgent((i) => ({
        proposal: { runId: i.runId, currency: 'USD', lines: gpu(1), justification: 'Fixture order.' }, usage, model: 'fixture',
      })),
    });
    await seedAll(env);
    driver = new LocalDriver(env);
  });
  afterAll(async () => { await env?.close(); });

  it('I8: expires without executing, and a late click changes nothing', async () => {
    const runId = await driver.startRun(REQUESTER, 'Never approved');
    const approvalId = await driver.waitForApproval(runId);
    await driver.waitForStatus(runId, ['EXPIRED'], 20_000);
    expect((await env.runs.getApproval(runId))!.state).toBe('EXPIRED');
    expect(await env.ledger.get(runId)).toBeNull();
    const late = await driver.click(runId, 'U0APPROVER1', 'approve', { approvalId });
    expect(late.text).toBe('This request expired.');
    expect((await env.runs.getMeta(runId))!.status).toBe('EXPIRED');
  });
});
