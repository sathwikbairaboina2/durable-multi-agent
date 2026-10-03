import type {
  BudgetsPort, CatalogPort, ExecuteOutcome, LedgerPort, RunMeta, RunsPort, StoredApproval, StoredProposal,
} from '../../src/adapters/ports.js';
import type { SlackPort } from '../../src/adapters/slack.js';
import type { WorkflowPort } from '../../src/adapters/workflow.js';
import { BudgetExhausted, IllegalTransition, InvalidProposal, NotApproved } from '../../src/core/errors.js';
import type { ExecutionPlan } from '../../src/core/execute.js';
import { assertTransition } from '../../src/core/status.js';
import type { Budget, CatalogItem, LedgerEntry, RunStatus } from '../../src/core/types.js';
import type { SlackMessage } from '../../src/core/slack-message.js';

export class FakeRuns implements RunsPort {
  metas = new Map<string, RunMeta>();
  proposals = new Map<string, StoredProposal>();
  approvals = new Map<string, StoredApproval>();
  lookups = new Map<string, string>();
  calls: string[] = [];

  async createRun(i: { runId: string; requesterId: string; request: string; nowIso: string }) {
    this.calls.push('createRun');
    if (this.metas.has(i.runId)) throw new Error('exists');
    this.metas.set(i.runId, {
      runId: i.runId, requesterId: i.requesterId, request: i.request, status: 'PLANNING', createdAt: i.nowIso, updatedAt: i.nowIso,
    });
  }
  async getMeta(runId: string) { return this.metas.get(runId) ?? null; }
  async update(runId: string, fields: Partial<Pick<RunMeta, 'executionArn' | 'slackTs' | 'slackChannel'>>) {
    this.calls.push('update');
    const m = this.metas.get(runId);
    if (!m) throw new Error('missing run');
    Object.assign(m, fields);
  }
  async transition(runId: string, from: RunStatus, to: RunStatus, nowIso: string, extra?: { failureReason?: string }) {
    this.calls.push(`transition:${from}->${to}`);
    assertTransition(from, to);
    const m = this.metas.get(runId);
    if (!m || m.status !== from) return false;
    m.status = to;
    m.updatedAt = nowIso;
    if (extra?.failureReason) m.failureReason = extra.failureReason;
    return true;
  }
  async putProposal(runId: string, p: StoredProposal) {
    this.calls.push('putProposal');
    const ex = this.proposals.get(runId);
    if (ex && ex.proposalHash !== p.proposalHash) throw new InvalidProposal('proposal already stored with a different hash');
    this.proposals.set(runId, p);
  }
  async getProposal(runId: string) { return this.proposals.get(runId) ?? null; }
  async createApproval(a: StoredApproval, nowIso: string) {
    this.calls.push('createApproval');
    const ex = this.approvals.get(a.runId);
    if (ex && ex.state !== 'PENDING') throw new Error('approval already decided');
    const m = this.metas.get(a.runId);
    if (!m || (m.status !== 'POLICY' && m.status !== 'AWAITING_APPROVAL')) throw new IllegalTransition('not in POLICY');
    this.approvals.set(a.runId, { ...a });
    this.lookups.set(a.approvalId, a.runId);
    m.status = 'AWAITING_APPROVAL';
    m.updatedAt = nowIso;
  }
  async findRunIdByApprovalId(approvalId: string) { this.calls.push('findRunIdByApprovalId'); return this.lookups.get(approvalId) ?? null; }
  async getApproval(runId: string) { return this.approvals.get(runId) ?? null; }
  async decideApproval(runId: string, approvalId: string, state: 'APPROVED' | 'REJECTED', decidedBy: string, nowIso: string) {
    this.calls.push('decideApproval');
    const a = this.approvals.get(runId);
    if (!a || a.state !== 'PENDING' || a.approvalId !== approvalId) return false;
    a.state = state;
    a.decidedBy = decidedBy;
    a.decidedAt = nowIso;
    return true;
  }
  async expireApproval(runId: string, nowIso: string) {
    this.calls.push('expireApproval');
    const a = this.approvals.get(runId);
    if (!a || a.state !== 'PENDING') return false;
    a.state = 'EXPIRED';
    a.decidedAt = nowIso;
    return true;
  }
  async listItems(runId: string) {
    const out: Record<string, unknown>[] = [];
    const m = this.metas.get(runId);
    if (m) out.push({ ...m });
    return out;
  }
  seedRun(runId: string, requesterId: string, status: RunStatus): RunMeta {
    const m: RunMeta = { runId, requesterId, request: 'req', status, createdAt: 't0', updatedAt: 't0' };
    this.metas.set(runId, m);
    return m;
  }
}

export class FakeCatalog implements CatalogPort {
  items = new Map<string, CatalogItem>();
  constructor(items: CatalogItem[] = []) { for (const i of items) this.items.set(i.sku, { ...i }); }
  async getMany(skus: string[]) {
    const out = new Map<string, CatalogItem>();
    for (const s of skus) { const i = this.items.get(s); if (i) out.set(s, i); }
    return out;
  }
  async listActive() { return [...this.items.values()].filter((i) => i.active); }
  async putAll(items: CatalogItem[]) { for (const i of items) this.items.set(i.sku, { ...i }); }
}

export class FakeBudgets implements BudgetsPort {
  rows = new Map<string, Budget>();
  private k = (r: string, m: string) => `${r}|${m}`;
  async get(requesterId: string, month: string) { const b = this.rows.get(this.k(requesterId, month)); return b ? { ...b } : null; }
  async put(b: Budget) { this.rows.set(this.k(b.requesterId, b.month), { ...b }); }
}

/** Mimics the transaction conditions of LedgerRepo.execute, atomically. */
export class FakeLedger implements LedgerPort {
  rows = new Map<string, LedgerEntry>();
  executeCalls = 0;
  constructor(private readonly runs: FakeRuns, private readonly budgets: FakeBudgets) {}
  async execute(
    plan: Extract<ExecutionPlan, { ok: true }>,
    i: { runId: string; requesterId: string; month: string; nowIso: string },
  ): Promise<ExecuteOutcome> {
    this.executeCalls++;
    const approval = this.runs.approvals.get(i.runId);
    const approvalOk = !!approval && approval.state === 'APPROVED' && approval.proposalHash === plan.proposalHash;
    const exists = this.rows.has(i.runId);
    if (exists) return { kind: 'ledger-exists' };
    if (!approvalOk) throw new NotApproved('approval is not APPROVED for this proposal');
    const b = this.budgets.rows.get(`${i.requesterId}|${i.month}`);
    if (!b || b.limitCents !== plan.limitCents || b.spentCents > plan.maxSpentBeforeCents) throw new BudgetExhausted('budget exhausted');
    const meta = this.runs.metas.get(i.runId);
    if (!meta || meta.status !== 'EXECUTING') throw new IllegalTransition('run is not EXECUTING');
    this.rows.set(i.runId, { ...plan.ledgerEntry });
    b.spentCents += plan.totalCents;
    meta.status = 'DONE';
    meta.updatedAt = i.nowIso;
    return { kind: 'written' };
  }
  async get(runId: string) { return this.rows.get(runId) ?? null; }
  async scanAll() { return [...this.rows.values()]; }
}

export class FakeWorkflow implements WorkflowPort {
  started: Array<{ runId: string; input: unknown }> = [];
  succeeded: Array<{ token: string; output: unknown }> = [];
  failed: Array<{ token: string; error: string; cause: string }> = [];
  succeedError?: Error;
  async start(runId: string, input: object) { this.started.push({ runId, input }); return `arn:aws:states:us-east-1:123456789012:execution:sm:${runId}`; }
  async succeed(token: string, output: object) {
    if (this.succeedError) throw this.succeedError;
    this.succeeded.push({ token, output });
  }
  async fail(token: string, error: string, cause: string) {
    if (this.succeedError) throw this.succeedError;
    this.failed.push({ token, error, cause });
  }
}

export class FakeSlack implements SlackPort {
  posted: Array<{ channel: string } & SlackMessage> = [];
  updated: Array<{ channel: string; ts: string } & SlackMessage> = [];
  failPost = false;
  failUpdate = false;
  async postMessage(m: { channel: string } & SlackMessage) {
    if (this.failPost) throw new Error('slack down');
    this.posted.push(m);
    return { ts: '1700000000.000100', channel: m.channel };
  }
  async updateMessage(m: { channel: string; ts: string } & SlackMessage) {
    if (this.failUpdate) throw new Error('slack down');
    this.updated.push(m);
  }
}

export class NamedError extends Error {
  constructor(name: string, message = name) { super(message); this.name = name; }
}
