import { GetCommand, ScanCommand, TransactWriteCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { ExecutionPlan } from '../core/execute.js';
import { BudgetExhausted, IllegalTransition, NotApproved } from '../core/errors.js';
import type { LedgerEntry } from '../core/types.js';
import type { ExecuteOutcome, LedgerPort } from './ports.js';
import { approvalKey, budgetKey, ledgerKey, metaKey, stripKeys } from './tables.js';

export interface LedgerTables { runs: string; budgets: string; ledger: string }

type Cancellation = { name?: string; CancellationReasons?: Array<{ Code?: string }> };

const failed = (e: Cancellation, i: number): boolean => e.CancellationReasons?.[i]?.Code === 'ConditionalCheckFailed';

export class LedgerRepo implements LedgerPort {
  constructor(private readonly doc: DynamoDBDocumentClient, private readonly t: LedgerTables) {}

  async execute(
    plan: Extract<ExecutionPlan, { ok: true }>,
    i: { runId: string; requesterId: string; month: string; nowIso: string },
  ): Promise<ExecuteOutcome> {
    try {
      await this.doc.send(new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: this.t.runs, Key: approvalKey(i.runId),
              ConditionExpression: '#state = :approved AND proposalHash = :h',
              ExpressionAttributeNames: { '#state': 'state' },
              ExpressionAttributeValues: { ':approved': 'APPROVED', ':h': plan.proposalHash },
            },
          },
          {
            Put: {
              TableName: this.t.ledger,
              Item: { ...ledgerKey(i.runId), ...plan.ledgerEntry },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          {
            Update: {
              TableName: this.t.budgets, Key: budgetKey(i.requesterId, i.month),
              UpdateExpression: 'SET spentCents = spentCents + :t',
              ConditionExpression: 'limitCents = :lim AND spentCents <= :maxBefore',
              ExpressionAttributeValues: { ':t': plan.totalCents, ':lim': plan.limitCents, ':maxBefore': plan.maxSpentBeforeCents },
            },
          },
          {
            Update: {
              TableName: this.t.runs, Key: metaKey(i.runId),
              UpdateExpression: 'SET #status = :done, updatedAt = :now',
              ConditionExpression: '#status = :executing',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: { ':done': 'DONE', ':executing': 'EXECUTING', ':now': i.nowIso },
            },
          },
        ],
      }));
      return { kind: 'written' };
    } catch (e) {
      const c = e as Cancellation;
      if (c.name !== 'TransactionCanceledException') throw e;
      if (failed(c, 1)) return { kind: 'ledger-exists' };
      if (failed(c, 0)) throw new NotApproved('approval is not APPROVED for this proposal');
      if (failed(c, 2)) throw new BudgetExhausted('budget exhausted');
      if (failed(c, 3)) throw new IllegalTransition('run is not EXECUTING');
      throw e;
    }
  }

  async get(runId: string): Promise<LedgerEntry | null> {
    const r = await this.doc.send(new GetCommand({ TableName: this.t.ledger, Key: ledgerKey(runId), ConsistentRead: true }));
    return r.Item ? (stripKeys(r.Item) as unknown as LedgerEntry) : null;
  }

  async scanAll(): Promise<LedgerEntry[]> {
    const out: LedgerEntry[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(new ScanCommand({ TableName: this.t.ledger, ExclusiveStartKey: start, ConsistentRead: true }));
      for (const item of r.Items ?? []) out.push(stripKeys(item) as unknown as LedgerEntry);
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  }
}
