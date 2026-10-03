import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { makeDocClient } from '../adapters/ddb.js';
import { LedgerRepo } from '../adapters/ledger-repo.js';
import type { LedgerPort, RunsPort } from '../adapters/ports.js';
import { RunsRepo } from '../adapters/runs-repo.js';
import { requireEnv, type Env } from '../config.js';
import { isUlid } from '../core/ids.js';
import { json } from './http.js';

export interface GetRunDeps { runs: RunsPort; ledger: LedgerPort }

export function makeGetRunHandler(deps: GetRunDeps) {
  return async (event: Pick<APIGatewayProxyEventV2, 'pathParameters'>): Promise<APIGatewayProxyStructuredResultV2> => {
    const runId = event.pathParameters?.runId;
    if (!isUlid(runId)) return json(404, { error: 'not found' });
    const meta = await deps.runs.getMeta(runId);
    if (!meta) return json(404, { error: 'not found' });
    const [proposal, approval, ledger] = await Promise.all([
      deps.runs.getProposal(runId), deps.runs.getApproval(runId), deps.ledger.get(runId),
    ]);
    return json(200, {
      runId,
      status: meta.status,
      ...(meta.failureReason ? { failureReason: meta.failureReason } : {}),
      ...(proposal ? { proposal: proposal.proposal, proposalHash: proposal.proposalHash } : {}),
      ...(approval
        ? { approval: { approvalId: approval.approvalId, state: approval.state, decidedBy: approval.decidedBy, totalCents: approval.totalCents } }
        : {}),
      ...(ledger ? { ledger } : {}),
    });
  };
}

export async function fromEnv(env: Env): Promise<(event: any) => Promise<any>> {
  const doc = makeDocClient(env);
  return makeGetRunHandler({
    runs: new RunsRepo(doc, requireEnv(env, 'RUNS_TABLE')),
    ledger: new LedgerRepo(doc, { runs: requireEnv(env, 'RUNS_TABLE'), budgets: env.BUDGETS_TABLE || 'unused', ledger: requireEnv(env, 'LEDGER_TABLE') }),
  });
}

let cached: Promise<(event: any) => Promise<any>> | undefined;
export const handler = async (event: unknown) => (await (cached ??= fromEnv(process.env)))(event);
