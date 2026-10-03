import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { makeStartRunHandler } from '../../../src/handlers/start-run.js';
import { FakeRuns, FakeWorkflow } from '../fakes.js';

const ev = (body: string | undefined, b64 = false) => ({ body, isBase64Encoded: b64, headers: {} }) as unknown as APIGatewayProxyEventV2;
const setup = () => {
  const runs = new FakeRuns();
  const workflow = new FakeWorkflow();
  return { runs, workflow, h: makeStartRunHandler({ runs, workflow, now: () => '2026-10-04T10:00:00.000Z' }) };
};

describe('start-run', () => {
  it('creates the run, starts the workflow named by the runId and returns 202', async () => {
    const { runs, workflow, h } = setup();
    const r = await h(ev(JSON.stringify({ request: 'buy 3 GPU boxes', requesterId: 'U0REQ1' })));
    expect(r).toMatchObject({ statusCode: 202 });
    const { runId } = JSON.parse((r as { body: string }).body);
    expect(workflow.started[0]!.runId).toBe(runId);
    expect(workflow.started[0]!.input).toEqual({ runId, requesterId: 'U0REQ1', request: 'buy 3 GPU boxes' });
    expect(runs.metas.get(runId)).toMatchObject({ status: 'PLANNING', requesterId: 'U0REQ1' });
    expect(runs.metas.get(runId)!.executionArn).toContain(runId);
  });
  it('accepts a base64 body', async () => {
    const { h } = setup();
    const body = Buffer.from(JSON.stringify({ request: 'x', requesterId: 'U0REQ1' })).toString('base64');
    expect(await h(ev(body, true))).toMatchObject({ statusCode: 202 });
  });
  it.each([
    ['empty request', { request: '', requesterId: 'U0REQ1' }],
    ['request too long', { request: 'x'.repeat(2001), requesterId: 'U0REQ1' }],
    ['bad requester', { request: 'x', requesterId: 'bob' }],
    ['missing requester', { request: 'x' }],
  ])('returns 400 on %s', async (_n, body) => {
    const { runs, workflow, h } = setup();
    expect(await h(ev(JSON.stringify(body)))).toMatchObject({ statusCode: 400 });
    expect(runs.calls).toEqual([]);
    expect(workflow.started).toEqual([]);
  });
  it('returns 400 on non-JSON', async () => {
    const { h } = setup();
    expect(await h(ev('nope'))).toMatchObject({ statusCode: 400 });
    expect(await h(ev(undefined))).toMatchObject({ statusCode: 400 });
  });
});
