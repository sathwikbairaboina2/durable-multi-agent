import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';
import { mockClient } from 'aws-sdk-client-mock';
import { describe, expect, it } from 'vitest';
import { AgentCoreAgentClient, HttpAgentClient, type AgentInvocation } from '../../../src/adapters/agent-client.js';
import { RUN_ID, validOrder } from '../fixtures.js';

const inv: AgentInvocation = { runId: RUN_ID, request: 'buy 3 GPU boxes', catalog: [] };
const ok = { proposal: validOrder(), usage: { inputTokens: 1, outputTokens: 2, modelSteps: 3 }, model: 'scripted' };
const resp = (body: string, status = 200) => async () => new Response(body, { status });

describe('HttpAgentClient', () => {
  it('posts to /invocations and returns the parsed body', async () => {
    let seen: { url: string; body: unknown } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify(ok), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await new HttpAgentClient('http://agent:5333', fetchImpl).invoke(inv);
    expect(seen?.url).toBe('http://agent:5333/invocations');
    expect(seen?.body).toMatchObject({ runId: RUN_ID });
    expect(r.model).toBe('scripted');
  });
  it('maps a non-2xx response to AgentFailed', async () => {
    await expect(new HttpAgentClient('http://a', resp('boom', 500) as unknown as typeof fetch).invoke(inv))
      .rejects.toMatchObject({ name: 'AgentFailed', message: 'agent HTTP 500' });
  });
  it('maps a non-JSON body to AgentFailed', async () => {
    await expect(new HttpAgentClient('http://a', resp('<html>') as unknown as typeof fetch).invoke(inv))
      .rejects.toMatchObject({ name: 'AgentFailed', message: 'agent returned non-JSON' });
  });
  it('maps the error envelope to AgentFailed', async () => {
    const body = JSON.stringify({ error: { type: 'BudgetExceeded', message: 'too many steps' } });
    await expect(new HttpAgentClient('http://a', resp(body) as unknown as typeof fetch).invoke(inv))
      .rejects.toMatchObject({ name: 'AgentFailed', message: 'BudgetExceeded: too many steps' });
  });
  it('rejects a body missing required fields', async () => {
    await expect(new HttpAgentClient('http://a', resp('{"proposal":{}}') as unknown as typeof fetch).invoke(inv))
      .rejects.toMatchObject({ name: 'AgentFailed' });
  });
  it('wraps network failures', async () => {
    const f = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    await expect(new HttpAgentClient('http://a', f).invoke(inv)).rejects.toMatchObject({ name: 'AgentFailed' });
  });
});

describe('AgentCoreAgentClient', () => {
  it('sends InvokeAgentRuntime with a long-enough session id and parses the stream', async () => {
    const m = mockClient(BedrockAgentCoreClient);
    m.on(InvokeAgentRuntimeCommand).resolves({
      response: { transformToString: async () => JSON.stringify(ok) } as never,
      contentType: 'application/json',
    } as never);
    const r = await new AgentCoreAgentClient(new BedrockAgentCoreClient({ region: 'us-east-1' }), 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/x').invoke(inv);
    const input = m.commandCalls(InvokeAgentRuntimeCommand)[0]!.args[0].input;
    expect(input.runtimeSessionId).toBe(`procurement-run-${RUN_ID}`);
    expect(input.runtimeSessionId!.length).toBeGreaterThanOrEqual(33);
    expect(r.proposal).toEqual(validOrder());
    m.restore();
  });
});
