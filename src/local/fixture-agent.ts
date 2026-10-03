import type { AgentClient, AgentInvocation, AgentResult } from '../adapters/agent-client.js';
import type { ProposalLine } from '../core/types.js';

export function functionAgent(fn: (i: AgentInvocation) => AgentResult | Promise<AgentResult>): AgentClient {
  return { invoke: async (i) => fn(i) };
}

/** An agent that always proposes the same lines. Fast and deterministic, for tests and the benchmark. */
export function fixedOrderAgent(lines: ProposalLine[], justification = 'Fixture order.'): AgentClient {
  return functionAgent((i) => ({
    proposal: { runId: i.runId, currency: 'USD', lines, justification },
    usage: { inputTokens: 0, outputTokens: 0, modelSteps: 0 },
    model: 'fixture',
  }));
}
