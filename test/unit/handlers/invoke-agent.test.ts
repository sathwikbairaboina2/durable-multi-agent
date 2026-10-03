import { describe, expect, it } from 'vitest';
import type { AgentClient, AgentInvocation } from '../../../src/adapters/agent-client.js';
import { AgentFailed } from '../../../src/core/errors.js';
import { makeInvokeAgentHandler } from '../../../src/handlers/invoke-agent.js';
import { FakeCatalog } from '../fakes.js';
import { CATALOG_ITEMS, RUN_ID, validOrder } from '../fixtures.js';

describe('invoke-agent', () => {
  it('passes the active catalog to the agent and returns its result', async () => {
    let seen: AgentInvocation | undefined;
    const agent: AgentClient = {
      async invoke(i) {
        seen = i;
        return { proposal: validOrder(), usage: { inputTokens: 1, outputTokens: 1, modelSteps: 1 }, model: 'scripted' };
      },
    };
    const h = makeInvokeAgentHandler({ catalog: new FakeCatalog(CATALOG_ITEMS), agent });
    const r = await h({ runId: RUN_ID, request: 'buy' });
    expect(r.model).toBe('scripted');
    expect(seen!.catalog.map((c) => c.sku)).toEqual(['GPU-DEVBOX-4090', 'LAPTOP-14-PRO', 'MONITOR-27-4K']);
    expect(Object.keys(seen!.catalog[0]!).sort()).toEqual(['maxQtyPerOrder', 'name', 'sku', 'unitPriceCents']);
  });
  it('propagates AgentFailed', async () => {
    const agent: AgentClient = { async invoke() { throw new AgentFailed('agent HTTP 500'); } };
    const h = makeInvokeAgentHandler({ catalog: new FakeCatalog(CATALOG_ITEMS), agent });
    await expect(h({ runId: RUN_ID, request: 'x' })).rejects.toMatchObject({ name: 'AgentFailed' });
  });
});
