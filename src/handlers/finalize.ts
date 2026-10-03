import { makeDocClient } from '../adapters/ddb.js';
import { log } from '../adapters/log.js';
import type { RunsPort } from '../adapters/ports.js';
import { RunsRepo } from '../adapters/runs-repo.js';
import { loadSlackSecrets } from '../adapters/secrets.js';
import { SlackWebClient, type SlackPort } from '../adapters/slack.js';
import { requireEnv, type Env } from '../config.js';
import { buildOutcomeMessage } from '../core/slack-message.js';
import { canTransition, isTerminal } from '../core/status.js';
import type { RunStatus } from '../core/types.js';

export type Outcome = 'DONE' | 'REJECTED_BY_POLICY' | 'REJECTED_BY_HUMAN' | 'EXPIRED' | 'FAILED';
export interface FinalizeDeps { runs: RunsPort; slack?: SlackPort; now: () => string }
export interface FinalizeEvent { runId: string; outcome: Outcome; error?: { Error?: string; Cause?: string } }

export function makeFinalizeHandler(deps: FinalizeDeps) {
  return async (event: FinalizeEvent): Promise<{ status: RunStatus }> => {
    const { runId, outcome } = event;
    if (outcome === 'EXPIRED') await deps.runs.expireApproval(runId, deps.now());

    let meta = await deps.runs.getMeta(runId);
    if (!meta) throw new Error(`run ${runId} not found`);

    const failureReason = outcome === 'FAILED'
      ? (event.error?.Error === 'BudgetExhausted' ? 'BUDGET_EXHAUSTED' : (event.error?.Error ?? 'UNKNOWN'))
      : undefined;

    if (meta.status !== outcome && !isTerminal(meta.status)) {
      let target: RunStatus = outcome;
      let reason = failureReason;
      if (!canTransition(meta.status, target)) {
        target = 'FAILED';
        reason = `${outcome}_UNREACHABLE_FROM_${meta.status}`;
      }
      const moved = await deps.runs.transition(runId, meta.status, target, deps.now(), reason ? { failureReason: reason } : undefined);
      if (!moved) {
        // Lost a race with another writer; report whatever the run is now.
        meta = (await deps.runs.getMeta(runId)) ?? meta;
        return { status: meta.status };
      }
      meta = (await deps.runs.getMeta(runId)) ?? meta;
    }

    if (deps.slack && meta.slackTs && meta.slackChannel && isTerminal(meta.status)) {
      try {
        const approval = await deps.runs.getApproval(runId);
        await deps.slack.updateMessage({
          channel: meta.slackChannel,
          ts: meta.slackTs,
          ...buildOutcomeMessage({
            runId,
            status: meta.status as Outcome,
            decidedBy: approval?.decidedBy,
            totalCents: approval?.totalCents,
            reason: meta.failureReason,
          }),
        });
      } catch (e) {
        log('warn', 'slack update failed', { runId, error: (e as Error).message });
      }
    }
    return { status: meta.status };
  };
}

export async function fromEnv(env: Env): Promise<(event: any) => Promise<any>> {
  const secrets = await loadSlackSecrets(env);
  return makeFinalizeHandler({
    runs: new RunsRepo(makeDocClient(env), requireEnv(env, 'RUNS_TABLE')),
    slack: new SlackWebClient(env.SLACK_API_BASE || 'https://slack.com/api', secrets.botToken),
    now: () => new Date().toISOString(),
  });
}

let cached: Promise<(event: any) => Promise<any>> | undefined;
export const handler = async (event: unknown) => (await (cached ??= fromEnv(process.env)))(event);
