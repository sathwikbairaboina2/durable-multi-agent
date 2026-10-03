import { log } from '../adapters/log.js';
import { makeDocClient } from '../adapters/ddb.js';
import type { RunsPort } from '../adapters/ports.js';
import { RunsRepo } from '../adapters/runs-repo.js';
import { loadSlackSecrets } from '../adapters/secrets.js';
import { SlackWebClient, type SlackPort } from '../adapters/slack.js';
import { intEnv, requireEnv, type Env } from '../config.js';
import { NotFound } from '../core/errors.js';
import { newApprovalId } from '../core/ids.js';
import { buildApprovalMessage } from '../core/slack-message.js';
import type { PolicyResult } from '../core/types.js';

export interface RequestApprovalDeps {
  runs: RunsPort; slack: SlackPort; channel: string; ttlSeconds: number; now: () => string;
}
export interface RequestApprovalEvent {
  taskToken: string; runId: string; requesterId: string; proposalHash: string; policy: PolicyResult;
}

export function makeRequestApprovalHandler(deps: RequestApprovalDeps) {
  return async (event: RequestApprovalEvent): Promise<{ approvalId: string }> => {
    const approvalId = newApprovalId();
    const nowIso = deps.now();
    const stored = await deps.runs.getProposal(event.runId);
    if (!stored) throw new NotFound(`no proposal for run ${event.runId}`);

    await deps.runs.createApproval({
      runId: event.runId,
      approvalId,
      taskToken: event.taskToken,
      proposalHash: event.proposalHash,
      totalCents: event.policy.totalCents,
      pricedLines: event.policy.pricedLines,
      state: 'PENDING',
      ttl: Math.floor(Date.parse(nowIso) / 1000) + deps.ttlSeconds,
    }, nowIso);

    // The Slack body is built from ids and priced lines only. The task token never leaves the Runs table (I11).
    const posted = await deps.slack.postMessage({
      channel: deps.channel,
      ...buildApprovalMessage({
        runId: event.runId,
        approvalId,
        requesterId: event.requesterId,
        pricedLines: event.policy.pricedLines,
        totalCents: event.policy.totalCents,
        remainingBudgetCents: event.policy.remainingBudgetCents,
        justification: stored.proposal.justification,
      }),
    });
    try {
      await deps.runs.update(event.runId, { slackTs: posted.ts, slackChannel: posted.channel });
    } catch (e) {
      log('warn', 'could not store slack message ref', { runId: event.runId, error: (e as Error).message });
    }
    log('info', 'approval requested', { runId: event.runId, approvalId });
    return { approvalId };
  };
}

export async function fromEnv(env: Env): Promise<(event: any) => Promise<any>> {
  const secrets = await loadSlackSecrets(env);
  return makeRequestApprovalHandler({
    runs: new RunsRepo(makeDocClient(env), requireEnv(env, 'RUNS_TABLE')),
    slack: new SlackWebClient(env.SLACK_API_BASE || 'https://slack.com/api', secrets.botToken),
    channel: requireEnv(env, 'SLACK_CHANNEL_ID'),
    ttlSeconds: intEnv(env, 'APPROVAL_TTL_SECONDS', 259200),
    now: () => new Date().toISOString(),
  });
}

let cached: Promise<(event: any) => Promise<any>> | undefined;
export const handler = async (event: unknown) => (await (cached ??= fromEnv(process.env)))(event);
