import { GetExecutionHistoryCommand, type HistoryEvent } from '@aws-sdk/client-sfn';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { RunMeta } from '../adapters/ports.js';
import type { RunStatus } from '../core/types.js';
import { signSlackRequest } from '../core/slack-verify.js';
import { LOCAL_SIGNING_SECRET, type LocalEnv } from './env.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function apiEvent(init: { body?: string; headers?: Record<string, string>; pathParameters?: Record<string, string> } = {}): APIGatewayProxyEventV2 {
  return {
    version: '2.0', routeKey: '$default', rawPath: '/', rawQueryString: '', isBase64Encoded: false,
    headers: init.headers ?? {}, body: init.body, pathParameters: init.pathParameters,
    requestContext: {} as never,
  } as unknown as APIGatewayProxyEventV2;
}

export interface ClickResult { statusCode: number; text: string }

/** Drives the deployed local stack the way a requester and a Slack approver would. */
export class LocalDriver {
  constructor(readonly env: LocalEnv) {}

  async startRun(requesterId: string, request: string): Promise<string> {
    const r = await this.env.handlers['start-run'](apiEvent({ body: JSON.stringify({ requesterId, request }) }));
    if (r.statusCode !== 202) throw new Error(`start-run returned ${r.statusCode}: ${r.body}`);
    return JSON.parse(r.body).runId as string;
  }

  async waitForStatus(runId: string, statuses: RunStatus[], timeoutMs = 60_000): Promise<RunMeta> {
    const deadline = Date.now() + timeoutMs;
    let last: RunStatus | 'missing' = 'missing';
    for (;;) {
      const meta = await this.env.runs.getMeta(runId);
      if (meta) {
        last = meta.status;
        if (statuses.includes(meta.status)) return meta;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ${runId} to reach ${statuses.join('|')}; last status ${last}`);
      }
      await sleep(100);
    }
  }

  async waitForApproval(runId: string, timeoutMs = 60_000): Promise<string> {
    await this.waitForStatus(runId, ['AWAITING_APPROVAL'], timeoutMs);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.env.slack.approvalFor(runId);
      if (found) return found.approvalId;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for the Slack approval post for ${runId}`);
      await sleep(50);
    }
  }

  async click(
    runId: string,
    userId: string,
    decision: 'approve' | 'reject',
    opts: { approvalId?: string; nowSeconds?: number } = {},
  ): Promise<ClickResult> {
    const approvalId = opts.approvalId ?? (await this.waitForApproval(runId));
    const payload = {
      type: 'block_actions',
      user: { id: userId },
      actions: [{ action_id: decision, value: JSON.stringify({ a: approvalId, d: decision }) }],
    };
    const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
    const ts = String(opts.nowSeconds ?? Math.floor(Date.now() / 1000));
    const res = await this.env.handlers['slack-interactions'](apiEvent({
      body,
      headers: {
        'x-slack-request-timestamp': ts,
        'x-slack-signature': signSlackRequest(LOCAL_SIGNING_SECRET, ts, body),
      },
    }));
    let text = '';
    try { text = JSON.parse(res.body).text ?? JSON.parse(res.body).error ?? ''; } catch { /* leave empty */ }
    return { statusCode: res.statusCode, text };
  }

  async getRun(runId: string): Promise<{ statusCode: number; body: any; raw: string }> {
    const r = await this.env.handlers['get-run'](apiEvent({ pathParameters: { runId } }));
    return { statusCode: r.statusCode, body: JSON.parse(r.body), raw: r.body };
  }

  async history(runId: string): Promise<HistoryEvent[]> {
    const meta = await this.env.runs.getMeta(runId);
    if (!meta?.executionArn) throw new Error(`run ${runId} has no execution ARN`);
    const events: HistoryEvent[] = [];
    let next: string | undefined;
    do {
      const r = await this.env.sfn.send(new GetExecutionHistoryCommand({ executionArn: meta.executionArn, nextToken: next }));
      events.push(...(r.events ?? []));
      next = r.nextToken;
    } while (next);
    return events;
  }
}
