import { makeDocClient } from '../adapters/ddb.js';
import type { AgentResult } from '../adapters/agent-client.js';
import type { RunsPort } from '../adapters/ports.js';
import { RunsRepo } from '../adapters/runs-repo.js';
import { requireEnv, type Env } from '../config.js';
import { IllegalTransition, InvalidProposal } from '../core/errors.js';
import { proposalHash } from '../core/hash.js';
import { validateProposedOrder } from '../core/schema.js';

export interface PersistProposalDeps { runs: RunsPort; now: () => string }
export interface PersistProposalEvent { runId: string; agent: AgentResult }

export function makePersistProposalHandler(deps: PersistProposalDeps) {
  return async (event: PersistProposalEvent): Promise<{ proposalHash: string }> => {
    const v = validateProposedOrder(event.agent?.proposal);
    if (!v.ok) throw new InvalidProposal(v.errors.join('; '));
    if (v.value.runId !== event.runId) throw new InvalidProposal('runId mismatch');
    const hash = proposalHash(v.value);
    await deps.runs.putProposal(event.runId, { proposal: v.value, proposalHash: hash, usage: event.agent.usage, model: event.agent.model });
    const moved = await deps.runs.transition(event.runId, 'PLANNING', 'POLICY', deps.now());
    if (!moved) {
      const meta = await deps.runs.getMeta(event.runId);
      if (meta?.status !== 'POLICY') throw new IllegalTransition(`${meta?.status ?? 'missing'} -> POLICY`);
    }
    return { proposalHash: hash };
  };
}

export async function fromEnv(env: Env): Promise<(event: any) => Promise<any>> {
  const runs = new RunsRepo(makeDocClient(env), requireEnv(env, 'RUNS_TABLE'));
  return makePersistProposalHandler({ runs, now: () => new Date().toISOString() });
}

let cached: Promise<(event: any) => Promise<any>> | undefined;
export const handler = async (event: unknown) => (await (cached ??= fromEnv(process.env)))(event);
