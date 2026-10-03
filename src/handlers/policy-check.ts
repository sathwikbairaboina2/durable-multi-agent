import { BudgetsRepo, monthOf } from '../adapters/budgets-repo.js';
import { CatalogRepo } from '../adapters/catalog-repo.js';
import { makeDocClient } from '../adapters/ddb.js';
import type { BudgetsPort, CatalogPort, RunsPort } from '../adapters/ports.js';
import { RunsRepo } from '../adapters/runs-repo.js';
import { intEnv, requireEnv, type Env } from '../config.js';
import { NotFound } from '../core/errors.js';
import { evaluatePolicy } from '../core/policy.js';
import type { PolicyResult } from '../core/types.js';

export interface PolicyCheckDeps {
  runs: RunsPort; catalog: CatalogPort; budgets: BudgetsPort; maxOrderCents: number; now: () => string;
}
export interface PolicyCheckEvent { runId: string; requesterId: string }

export function makePolicyCheckHandler(deps: PolicyCheckDeps) {
  return async (event: PolicyCheckEvent): Promise<PolicyResult> => {
    const stored = await deps.runs.getProposal(event.runId);
    if (!stored) throw new NotFound(`no proposal for run ${event.runId}`);
    const catalog = await deps.catalog.getMany(stored.proposal.lines.map((l) => l.sku));
    const budget = await deps.budgets.get(event.requesterId, monthOf(deps.now()));
    return evaluatePolicy({ proposal: stored.proposal, catalog, budget, maxOrderCents: deps.maxOrderCents });
  };
}

export async function fromEnv(env: Env): Promise<(event: any) => Promise<any>> {
  const doc = makeDocClient(env);
  return makePolicyCheckHandler({
    runs: new RunsRepo(doc, requireEnv(env, 'RUNS_TABLE')),
    catalog: new CatalogRepo(doc, requireEnv(env, 'CATALOG_TABLE')),
    budgets: new BudgetsRepo(doc, requireEnv(env, 'BUDGETS_TABLE')),
    maxOrderCents: intEnv(env, 'MAX_ORDER_CENTS', 1_000_000),
    now: () => new Date().toISOString(),
  });
}

let cached: Promise<(event: any) => Promise<any>> | undefined;
export const handler = async (event: unknown) => (await (cached ??= fromEnv(process.env)))(event);
