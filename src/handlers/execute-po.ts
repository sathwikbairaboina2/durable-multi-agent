import { BudgetsRepo, monthOf } from '../adapters/budgets-repo.js';
import { makeDocClient } from '../adapters/ddb.js';
import { LedgerRepo } from '../adapters/ledger-repo.js';
import type { BudgetsPort, LedgerPort, RunsPort } from '../adapters/ports.js';
import { RunsRepo } from '../adapters/runs-repo.js';
import { requireEnv, type Env } from '../config.js';
import { BudgetExhausted, HashMismatch, NotApproved, NotFound } from '../core/errors.js';
import { planExecution } from '../core/execute.js';

export interface ExecutePoDeps { runs: RunsPort; budgets: BudgetsPort; ledger: LedgerPort; now: () => string }
export interface ExecutePoEvent { runId: string; requesterId: string }
export type ExecutePoResult =
  | { ledgerWritten: true; totalCents: number }
  | { alreadyExecuted: true; totalCents: number };

export function makeExecutePoHandler(deps: ExecutePoDeps) {
  async function readBack(runId: string): Promise<ExecutePoResult> {
    const [entry, approval] = await Promise.all([deps.ledger.get(runId), deps.runs.getApproval(runId)]);
    if (!entry || !approval || entry.proposalHash !== approval.proposalHash) {
      throw new HashMismatch('ledger row does not match the approved proposal');
    }
    return { alreadyExecuted: true, totalCents: entry.totalCents };
  }

  return async (event: ExecutePoEvent): Promise<ExecutePoResult> => {
    const { runId } = event;
    let meta = await deps.runs.getMeta(runId);
    if (!meta) throw new NotFound(`run ${runId} not found`);
    if (meta.status === 'DONE') return readBack(runId);

    if (meta.status === 'AWAITING_APPROVAL') {
      const moved = await deps.runs.transition(runId, 'AWAITING_APPROVAL', 'EXECUTING', deps.now());
      if (!moved) {
        meta = await deps.runs.getMeta(runId);
        if (meta?.status === 'DONE') return readBack(runId);
        if (meta?.status !== 'EXECUTING') throw new NotApproved(`run is ${meta?.status ?? 'missing'}`);
      }
    } else if (meta.status !== 'EXECUTING') {
      throw new NotApproved(`run is ${meta.status}`);
    }

    const [approval, proposal, budget] = await Promise.all([
      deps.runs.getApproval(runId),
      deps.runs.getProposal(runId),
      deps.budgets.get(event.requesterId, monthOf(deps.now())),
    ]);
    if (!proposal) throw new NotFound(`no proposal for run ${runId}`);
    // Hash the stored proposal object itself. The stored proposalHash field is never trusted (I1).
    const plan = planExecution({
      runId, requesterId: event.requesterId, storedProposal: proposal.proposal, approval, budget, nowIso: deps.now(),
    });
    if (!plan.ok) {
      if (plan.error === 'HashMismatch') throw new HashMismatch(plan.message);
      if (plan.error === 'BudgetExhausted') throw new BudgetExhausted(plan.message);
      throw new NotApproved(plan.message);
    }
    const outcome = await deps.ledger.execute(plan, {
      runId, requesterId: event.requesterId, month: monthOf(deps.now()), nowIso: deps.now(),
    });
    if (outcome.kind === 'written') return { ledgerWritten: true, totalCents: plan.totalCents };
    return readBack(runId);
  };
}

export async function fromEnv(env: Env): Promise<(event: any) => Promise<any>> {
  const doc = makeDocClient(env);
  const tables = { runs: requireEnv(env, 'RUNS_TABLE'), budgets: requireEnv(env, 'BUDGETS_TABLE'), ledger: requireEnv(env, 'LEDGER_TABLE') };
  return makeExecutePoHandler({
    runs: new RunsRepo(doc, tables.runs),
    budgets: new BudgetsRepo(doc, tables.budgets),
    ledger: new LedgerRepo(doc, tables),
    now: () => new Date().toISOString(),
  });
}

let cached: Promise<(event: any) => Promise<any>> | undefined;
export const handler = async (event: unknown) => (await (cached ??= fromEnv(process.env)))(event);
