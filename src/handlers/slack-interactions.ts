import { SFNClient } from '@aws-sdk/client-sfn';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { makeDocClient } from '../adapters/ddb.js';
import { log } from '../adapters/log.js';
import type { RunsPort, StoredApproval } from '../adapters/ports.js';
import { RunsRepo } from '../adapters/runs-repo.js';
import { loadSlackSecrets } from '../adapters/secrets.js';
import { StepFunctionsWorkflow, type WorkflowPort } from '../adapters/workflow.js';
import { requireEnv, type Env } from '../config.js';
import { authorizeApprover, parseApproverIds } from '../core/authorize.js';
import { parseActionValue } from '../core/slack-message.js';
import { verifySlackRequest } from '../core/slack-verify.js';
import { header, json, rawBody } from './http.js';

export interface SlackInteractionsDeps {
  runs: RunsPort;
  workflow: WorkflowPort;
  signingSecret: string;
  approverIds: string[];
  now: () => string;
}

const ephemeral = (text: string): APIGatewayProxyStructuredResultV2 => json(200, { response_type: 'ephemeral', text });

function decidedReply(a: StoredApproval): string {
  if (a.state === 'EXPIRED') return 'This request expired.';
  return `Already decided${a.decidedBy ? ` by <@${a.decidedBy}>` : ''}.`;
}

export function makeSlackInteractionsHandler(deps: SlackInteractionsDeps) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const raw = rawBody(event);
    const verified = verifySlackRequest({
      signingSecret: deps.signingSecret,
      timestamp: header(event, 'x-slack-request-timestamp'),
      signature: header(event, 'x-slack-signature'),
      rawBody: raw,
      nowSeconds: Math.floor(Date.parse(deps.now()) / 1000),
    });
    if (!verified.ok) {
      log('warn', 'slack request rejected', { reason: verified.reason });
      return json(401, { error: 'invalid signature' });
    }

    let payload: any;
    try {
      payload = JSON.parse(new URLSearchParams(raw).get('payload') ?? '');
    } catch {
      return ephemeral('Unsupported interaction.');
    }
    if (payload?.type !== 'block_actions' || typeof payload?.user?.id !== 'string') return ephemeral('Unsupported interaction.');
    const value = payload?.actions?.[0]?.value;
    const action = typeof value === 'string' ? parseActionValue(value) : null;
    if (!action) return ephemeral('Unsupported interaction.');
    const userId: string = payload.user.id;

    const runId = await deps.runs.findRunIdByApprovalId(action.approvalId);
    if (!runId) return ephemeral('Unknown approval.');
    const approval = await deps.runs.getApproval(runId);
    const meta = await deps.runs.getMeta(runId);
    if (!approval || !meta || approval.approvalId !== action.approvalId) return ephemeral('Unknown approval.');
    if (approval.state !== 'PENDING') return ephemeral(decidedReply(approval));

    const auth = authorizeApprover({ approverId: userId, requesterId: meta.requesterId, approverIds: deps.approverIds });
    if (!auth.ok) {
      return ephemeral(auth.reason === 'SELF_APPROVAL' ? 'You cannot approve your own request.' : 'You are not an approver for this request.');
    }

    const state = action.decision === 'approve' ? 'APPROVED' : 'REJECTED';
    const won = await deps.runs.decideApproval(runId, action.approvalId, state, userId, deps.now());
    if (!won) {
      const again = await deps.runs.getApproval(runId);
      return ephemeral(again ? decidedReply(again) : 'Unknown approval.');
    }

    try {
      if (action.decision === 'approve') {
        await deps.workflow.succeed(approval.taskToken, { decision: 'approve', approver: userId, proposalHash: approval.proposalHash });
      } else {
        await deps.workflow.fail(approval.taskToken, 'HumanRejected', `rejected by ${userId}`);
      }
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'TaskTimedOut' || name === 'TaskDoesNotExist') return ephemeral('This request expired.');
      throw e;
    }
    log('info', 'approval decided', { runId, approvalId: action.approvalId, decision: action.decision });
    return ephemeral(action.decision === 'approve' ? 'Approved. Placing the order.' : 'Rejected.');
  };
}

export async function fromEnv(env: Env): Promise<(event: any) => Promise<any>> {
  const secrets = await loadSlackSecrets(env);
  const sfn = new SFNClient({ region: env.AWS_REGION || 'us-east-1', ...(env.SFN_ENDPOINT ? { endpoint: env.SFN_ENDPOINT } : {}) });
  return makeSlackInteractionsHandler({
    runs: new RunsRepo(makeDocClient(env), requireEnv(env, 'RUNS_TABLE')),
    workflow: new StepFunctionsWorkflow(sfn, requireEnv(env, 'STATE_MACHINE_ARN')),
    signingSecret: secrets.signingSecret,
    approverIds: parseApproverIds(env.APPROVER_IDS),
    now: () => new Date().toISOString(),
  });
}

let cached: Promise<(event: any) => Promise<any>> | undefined;
export const handler = async (event: unknown) => (await (cached ??= fromEnv(process.env)))(event);
