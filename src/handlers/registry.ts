import type { Env } from '../config.js';
import * as executePo from './execute-po.js';
import * as finalize from './finalize.js';
import * as getRun from './get-run.js';
import * as invokeAgent from './invoke-agent.js';
import * as persistProposal from './persist-proposal.js';
import * as policyCheck from './policy-check.js';
import * as requestApproval from './request-approval.js';
import * as slackInteractions from './slack-interactions.js';
import * as startRun from './start-run.js';

export const HANDLER_NAMES = [
  'start-run', 'get-run', 'slack-interactions', 'invoke-agent', 'persist-proposal',
  'policy-check', 'request-approval', 'execute-po', 'finalize',
] as const;
export type HandlerName = (typeof HANDLER_NAMES)[number];

type Entry = { fromEnv(env: Env): Promise<(e: any) => Promise<any>> };

export const REGISTRY: Record<HandlerName, Entry> = {
  'start-run': startRun,
  'get-run': getRun,
  'slack-interactions': slackInteractions,
  'invoke-agent': invokeAgent,
  'persist-proposal': persistProposal,
  'policy-check': policyCheck,
  'request-approval': requestApproval,
  'execute-po': executePo,
  finalize,
};
