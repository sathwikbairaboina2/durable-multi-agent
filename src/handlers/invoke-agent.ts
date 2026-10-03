import { BedrockAgentCoreClient } from '@aws-sdk/client-bedrock-agentcore';
import { AgentCoreAgentClient, HttpAgentClient, type AgentClient, type AgentResult } from '../adapters/agent-client.js';
import { CatalogRepo } from '../adapters/catalog-repo.js';
import { makeDocClient } from '../adapters/ddb.js';
import type { CatalogPort } from '../adapters/ports.js';
import { requireEnv, type Env } from '../config.js';

export interface InvokeAgentDeps { catalog: CatalogPort; agent: AgentClient }
export interface InvokeAgentEvent { runId: string; request: string }

export function makeInvokeAgentHandler(deps: InvokeAgentDeps) {
  return async (event: InvokeAgentEvent): Promise<AgentResult> => {
    const items = await deps.catalog.listActive();
    const catalog = items.map(({ sku, name, unitPriceCents, maxQtyPerOrder }) => ({ sku, name, unitPriceCents, maxQtyPerOrder }));
    const r = await deps.agent.invoke({ runId: event.runId, request: event.request, catalog });
    return { proposal: r.proposal, usage: r.usage, model: r.model };
  };
}

export async function fromEnv(env: Env): Promise<(event: any) => Promise<any>> {
  const catalog = new CatalogRepo(makeDocClient(env), requireEnv(env, 'CATALOG_TABLE'));
  let agent: AgentClient;
  if (env.AGENT_URL) agent = new HttpAgentClient(env.AGENT_URL);
  else if (env.AGENT_RUNTIME_ARN) agent = new AgentCoreAgentClient(new BedrockAgentCoreClient({}), env.AGENT_RUNTIME_ARN);
  else throw new Error('Set AGENT_URL or AGENT_RUNTIME_ARN');
  return makeInvokeAgentHandler({ catalog, agent });
}

let cached: Promise<(event: any) => Promise<any>> | undefined;
export const handler = async (event: unknown) => (await (cached ??= fromEnv(process.env)))(event);
