import type { ExecutionPlan } from '../core/execute.js';
import type {
  ApprovalRecord, Budget, CatalogItem, LedgerEntry, ModelUsage, ProposedOrder, RunStatus,
} from '../core/types.js';

export interface RunMeta {
  runId: string; requesterId: string; request: string; status: RunStatus;
  createdAt: string; updatedAt: string;
  executionArn?: string; failureReason?: string; slackTs?: string; slackChannel?: string;
}
export interface StoredProposal { proposal: ProposedOrder; proposalHash: string; usage: ModelUsage }
export interface StoredApproval extends ApprovalRecord { taskToken: string; ttl: number }

export interface RunsPort {
  createRun(i: { runId: string; requesterId: string; request: string; nowIso: string }): Promise<void>;
  getMeta(runId: string): Promise<RunMeta | null>;
  update(runId: string, fields: Partial<Pick<RunMeta, 'executionArn' | 'slackTs' | 'slackChannel'>>): Promise<void>;
  /** Asserts the transition is legal, then applies it under a condition on the prior status. False when the prior status differs. */
  transition(runId: string, from: RunStatus, to: RunStatus, nowIso: string, extra?: { failureReason?: string }): Promise<boolean>;
  putProposal(runId: string, p: StoredProposal): Promise<void>;
  getProposal(runId: string): Promise<StoredProposal | null>;
  createApproval(a: StoredApproval, nowIso: string): Promise<void>;
  findRunIdByApprovalId(approvalId: string): Promise<string | null>;
  getApproval(runId: string): Promise<StoredApproval | null>;
  decideApproval(runId: string, approvalId: string, state: 'APPROVED' | 'REJECTED', decidedBy: string, nowIso: string): Promise<boolean>;
  expireApproval(runId: string, nowIso: string): Promise<boolean>;
  listItems(runId: string): Promise<Record<string, unknown>[]>;
}

export interface CatalogPort {
  getMany(skus: string[]): Promise<Map<string, CatalogItem>>;
  listActive(): Promise<CatalogItem[]>;
  putAll(items: CatalogItem[]): Promise<void>;
}

export interface BudgetsPort {
  get(requesterId: string, month: string): Promise<Budget | null>;
  put(b: Budget): Promise<void>;
}

export type ExecuteOutcome = { kind: 'written' } | { kind: 'ledger-exists' };

export interface LedgerPort {
  execute(
    plan: Extract<ExecutionPlan, { ok: true }>,
    i: { runId: string; requesterId: string; month: string; nowIso: string },
  ): Promise<ExecuteOutcome>;
  get(runId: string): Promise<LedgerEntry | null>;
  scanAll(): Promise<LedgerEntry[]>;
}
