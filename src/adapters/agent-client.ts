import { InvokeAgentRuntimeCommand, type BedrockAgentCoreClient } from '@aws-sdk/client-bedrock-agentcore';
import { AgentFailed } from '../core/errors.js';
import type { CatalogItem, ModelUsage } from '../core/types.js';

export interface AgentInvocation {
  runId: string;
  request: string;
  catalog: Array<Pick<CatalogItem, 'sku' | 'name' | 'unitPriceCents' | 'maxQtyPerOrder'>>;
}
export interface AgentResult { proposal: unknown; usage: ModelUsage; model: string }
export interface AgentClient { invoke(i: AgentInvocation): Promise<AgentResult> }

export function parseAgentBody(text: string): AgentResult {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AgentFailed('agent returned non-JSON');
  }
  if (!body || typeof body !== 'object') throw new AgentFailed('agent returned non-JSON');
  const o = body as Record<string, unknown>;
  if (o.error && typeof o.error === 'object') {
    const e = o.error as { type?: string; message?: string };
    throw new AgentFailed(`${e.type ?? 'Error'}: ${e.message ?? ''}`);
  }
  if (!('proposal' in o) || !o.usage || typeof o.model !== 'string') throw new AgentFailed('agent response missing proposal, usage or model');
  return { proposal: o.proposal, usage: o.usage as ModelUsage, model: o.model };
}

export class HttpAgentClient implements AgentClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 300_000,
  ) {}

  async invoke(i: AgentInvocation): Promise<AgentResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/invocations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(i),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new AgentFailed(`agent unreachable: ${(e as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) throw new AgentFailed(`agent HTTP ${res.status}`);
    return parseAgentBody(text);
  }
}

export class AgentCoreAgentClient implements AgentClient {
  constructor(private readonly client: BedrockAgentCoreClient, private readonly agentRuntimeArn: string) {}

  async invoke(i: AgentInvocation): Promise<AgentResult> {
    const res = await this.client.send(new InvokeAgentRuntimeCommand({
      agentRuntimeArn: this.agentRuntimeArn,
      runtimeSessionId: `procurement-run-${i.runId}`,
      contentType: 'application/json',
      accept: 'application/json',
      payload: new TextEncoder().encode(JSON.stringify(i)),
    }));
    const text = await res.response!.transformToString();
    return parseAgentBody(text);
  }
}
