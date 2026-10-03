import { GetCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Budget } from '../core/types.js';
import type { BudgetsPort } from './ports.js';
import { budgetKey } from './tables.js';

export const monthOf = (iso: string): string => iso.slice(0, 7);

export class BudgetsRepo implements BudgetsPort {
  constructor(private readonly doc: DynamoDBDocumentClient, private readonly table: string) {}

  async get(requesterId: string, month: string): Promise<Budget | null> {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: budgetKey(requesterId, month), ConsistentRead: true }));
    if (!r.Item) return null;
    return { requesterId, month, limitCents: r.Item.limitCents, spentCents: r.Item.spentCents };
  }

  async put(b: Budget): Promise<void> {
    await this.doc.send(new PutCommand({
      TableName: this.table,
      Item: { ...budgetKey(b.requesterId, b.month), limitCents: b.limitCents, spentCents: b.spentCents },
    }));
  }
}
