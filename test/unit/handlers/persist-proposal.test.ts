import { describe, expect, it } from 'vitest';
import type { AgentResult } from '../../../src/adapters/agent-client.js';
import { proposalHash } from '../../../src/core/hash.js';
import { makePersistProposalHandler } from '../../../src/handlers/persist-proposal.js';
import { FakeRuns } from '../fakes.js';
import { RUN_ID, validOrder } from '../fixtures.js';

const usage = { inputTokens: 1, outputTokens: 1, modelSteps: 1 };
const agentOf = (proposal: unknown): AgentResult => ({ proposal, usage, model: 'scripted' });
const setup = () => {
  const runs = new FakeRuns();
  runs.seedRun(RUN_ID, 'U0REQ1', 'PLANNING');
  return { runs, h: makePersistProposalHandler({ runs, now: () => 'now' }) };
};

describe('persist-proposal (I9)', () => {
  it('stores a valid proposal with its hash and moves to POLICY', async () => {
    const { runs, h } = setup();
    const r = await h({ runId: RUN_ID, agent: agentOf(validOrder()) });
    expect(r.proposalHash).toBe(proposalHash(validOrder()));
    expect(runs.metas.get(RUN_ID)!.status).toBe('POLICY');
    expect(runs.proposals.get(RUN_ID)!.proposalHash).toBe(r.proposalHash);
  });

  const bad: Array<[string, unknown]> = [
    ['extra field', { ...validOrder(), admin: true }],
    ['qty 0', { ...validOrder(), lines: [{ sku: 'A', qty: 0 }] }],
    ['11 lines', { ...validOrder(), lines: Array.from({ length: 11 }, () => ({ sku: 'A', qty: 1 })) }],
    ['wrong runId', { ...validOrder(), runId: '01J9ZX5K3M8Q4R6T7V9W1Y2ZZZ' }],
  ];
  it.each(bad)('rejects %s without storing anything', async (_n, proposal) => {
    const { runs, h } = setup();
    await expect(h({ runId: RUN_ID, agent: agentOf(proposal) })).rejects.toMatchObject({ name: 'InvalidProposal' });
    expect(runs.calls).not.toContain('putProposal');
    expect(runs.metas.get(RUN_ID)!.status).toBe('PLANNING');
  });

  it('is idempotent on a retry', async () => {
    const { runs, h } = setup();
    await h({ runId: RUN_ID, agent: agentOf(validOrder()) });
    await expect(h({ runId: RUN_ID, agent: agentOf(validOrder()) })).resolves.toMatchObject({ proposalHash: proposalHash(validOrder()) });
    expect(runs.metas.get(RUN_ID)!.status).toBe('POLICY');
  });

  it('refuses a retry in a later status', async () => {
    const { runs, h } = setup();
    await h({ runId: RUN_ID, agent: agentOf(validOrder()) });
    runs.metas.get(RUN_ID)!.status = 'AWAITING_APPROVAL';
    await expect(h({ runId: RUN_ID, agent: agentOf(validOrder()) })).rejects.toMatchObject({ name: 'IllegalTransition' });
  });
});
