import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { makeDocClient } from '../adapters/ddb.js';
import { RunsRepo } from '../adapters/runs-repo.js';
import type { RunsPort } from '../adapters/ports.js';
import { StepFunctionsWorkflow, type WorkflowPort } from '../adapters/workflow.js';
import { SFNClient } from '@aws-sdk/client-sfn';
import { requireEnv, type Env } from '../config.js';
import { newRunId } from '../core/ids.js';
import { json, rawBody } from './http.js';

export interface StartRunDeps { runs: RunsPort; workflow: WorkflowPort; now: () => string }

const REQUESTER = /^[UW][A-Z0-9]{2,20}$/;

export function makeStartRunHandler(deps: StartRunDeps) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    let body: unknown;
    try {
      body = JSON.parse(rawBody(event));
    } catch {
      return json(400, { error: 'body must be JSON' });
    }
    const b = (body && typeof body === 'object' ? body : {}) as { request?: unknown; requesterId?: unknown };
    if (typeof b.request !== 'string' || b.request.trim().length < 1 || b.request.length > 2000) {
      return json(400, { error: 'request must be 1-2000 characters' });
    }
    if (typeof b.requesterId !== 'string' || !REQUESTER.test(b.requesterId)) {
      return json(400, { error: 'requesterId must be a Slack user id' });
    }
    const runId = newRunId();
    await deps.runs.createRun({ runId, requesterId: b.requesterId, request: b.request, nowIso: deps.now() });
    const executionArn = await deps.workflow.start(runId, { runId, requesterId: b.requesterId, request: b.request });
    await deps.runs.update(runId, { executionArn });
    return json(202, { runId });
  };
}

export async function fromEnv(env: Env): Promise<(event: any) => Promise<any>> {
  const runs = new RunsRepo(makeDocClient(env), requireEnv(env, 'RUNS_TABLE'));
  const sfn = new SFNClient({ region: env.AWS_REGION || 'us-east-1', ...(env.SFN_ENDPOINT ? { endpoint: env.SFN_ENDPOINT } : {}) });
  const workflow = new StepFunctionsWorkflow(sfn, requireEnv(env, 'STATE_MACHINE_ARN'));
  return makeStartRunHandler({ runs, workflow, now: () => new Date().toISOString() });
}

let cached: Promise<(event: any) => Promise<any>> | undefined;
export const handler = async (event: unknown) => (await (cached ??= fromEnv(process.env)))(event);
