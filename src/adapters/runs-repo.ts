import {
  GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand, type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { InvalidProposal } from '../core/errors.js';
import { assertTransition } from '../core/status.js';
import type { RunStatus } from '../core/types.js';
import { isConditionFailed } from './ddb.js';
import type { RunMeta, RunsPort, StoredApproval, StoredProposal } from './ports.js';
import { approvalKey, lookupKey, metaKey, proposalKey, runKey, stripKeys } from './tables.js';

export class RunsRepo implements RunsPort {
  constructor(private readonly doc: DynamoDBDocumentClient, private readonly table: string) {}

  async createRun(i: { runId: string; requesterId: string; request: string; nowIso: string }): Promise<void> {
    await this.doc.send(new PutCommand({
      TableName: this.table,
      Item: {
        ...metaKey(i.runId), runId: i.runId, requesterId: i.requesterId, request: i.request,
        status: 'PLANNING', createdAt: i.nowIso, updatedAt: i.nowIso,
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    }));
  }

  async getMeta(runId: string): Promise<RunMeta | null> {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: metaKey(runId), ConsistentRead: true }));
    return r.Item ? (stripKeys(r.Item) as unknown as RunMeta) : null;
  }

  async update(runId: string, fields: Partial<Pick<RunMeta, 'executionArn' | 'slackTs' | 'slackChannel'>>): Promise<void> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const sets = entries.map(([k, v], i) => {
      names[`#f${i}`] = k;
      values[`:v${i}`] = v;
      return `#f${i} = :v${i}`;
    });
    await this.doc.send(new UpdateCommand({
      TableName: this.table, Key: metaKey(runId),
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names, ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(pk)',
    }));
  }

  async transition(runId: string, from: RunStatus, to: RunStatus, nowIso: string, extra?: { failureReason?: string }): Promise<boolean> {
    assertTransition(from, to);
    const names: Record<string, string> = { '#status': 'status' };
    const values: Record<string, unknown> = { ':from': from, ':to': to, ':now': nowIso };
    let set = '#status = :to, updatedAt = :now';
    if (extra?.failureReason) {
      names['#fr'] = 'failureReason';
      values[':fr'] = extra.failureReason;
      set += ', #fr = :fr';
    }
    try {
      await this.doc.send(new UpdateCommand({
        TableName: this.table, Key: metaKey(runId),
        UpdateExpression: `SET ${set}`, ConditionExpression: '#status = :from',
        ExpressionAttributeNames: names, ExpressionAttributeValues: values,
      }));
      return true;
    } catch (e) {
      if (isConditionFailed(e)) return false;
      throw e;
    }
  }

  async putProposal(runId: string, p: StoredProposal): Promise<void> {
    try {
      await this.doc.send(new PutCommand({
        TableName: this.table,
        Item: { ...proposalKey(runId), proposal: p.proposal, proposalHash: p.proposalHash, usage: p.usage, model: p.model },
        ConditionExpression: 'attribute_not_exists(pk) OR proposalHash = :h',
        ExpressionAttributeValues: { ':h': p.proposalHash },
      }));
    } catch (e) {
      if (isConditionFailed(e)) throw new InvalidProposal('proposal already stored with a different hash');
      throw e;
    }
  }

  async getProposal(runId: string): Promise<StoredProposal | null> {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: proposalKey(runId), ConsistentRead: true }));
    if (!r.Item) return null;
    return { proposal: r.Item.proposal, proposalHash: r.Item.proposalHash, usage: r.Item.usage, model: r.Item.model } as StoredProposal;
  }

  async createApproval(a: StoredApproval, nowIso: string): Promise<void> {
    await this.doc.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: this.table,
            Item: { ...approvalKey(a.runId), ...a },
            ConditionExpression: 'attribute_not_exists(pk) OR #state = :pending',
            ExpressionAttributeNames: { '#state': 'state' },
            ExpressionAttributeValues: { ':pending': 'PENDING' },
          },
        },
        {
          Put: { TableName: this.table, Item: { ...lookupKey(a.approvalId), runId: a.runId } },
        },
        {
          Update: {
            TableName: this.table, Key: metaKey(a.runId),
            UpdateExpression: 'SET #status = :aw, updatedAt = :now',
            ConditionExpression: '#status IN (:policy, :aw)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':aw': 'AWAITING_APPROVAL', ':policy': 'POLICY', ':now': nowIso },
          },
        },
      ],
    }));
  }

  async findRunIdByApprovalId(approvalId: string): Promise<string | null> {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: lookupKey(approvalId), ConsistentRead: true }));
    return r.Item ? (r.Item.runId as string) : null;
  }

  async getApproval(runId: string): Promise<StoredApproval | null> {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: approvalKey(runId), ConsistentRead: true }));
    return r.Item ? (stripKeys(r.Item) as unknown as StoredApproval) : null;
  }

  async decideApproval(runId: string, approvalId: string, state: 'APPROVED' | 'REJECTED', decidedBy: string, nowIso: string): Promise<boolean> {
    try {
      await this.doc.send(new UpdateCommand({
        TableName: this.table, Key: approvalKey(runId),
        UpdateExpression: 'SET #state = :s, decidedBy = :by, decidedAt = :at',
        ConditionExpression: '#state = :pending AND approvalId = :id',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: { ':s': state, ':by': decidedBy, ':at': nowIso, ':pending': 'PENDING', ':id': approvalId },
      }));
      return true;
    } catch (e) {
      if (isConditionFailed(e)) return false;
      throw e;
    }
  }

  async expireApproval(runId: string, nowIso: string): Promise<boolean> {
    try {
      await this.doc.send(new UpdateCommand({
        TableName: this.table, Key: approvalKey(runId),
        UpdateExpression: 'SET #state = :expired, decidedAt = :at',
        ConditionExpression: '#state = :pending',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: { ':expired': 'EXPIRED', ':pending': 'PENDING', ':at': nowIso },
      }));
      return true;
    } catch (e) {
      if (isConditionFailed(e)) return false;
      throw e;
    }
  }

  async listItems(runId: string): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': runKey(runId, '').pk },
        ConsistentRead: true,
        ExclusiveStartKey: start,
      }));
      items.push(...(r.Items ?? []));
      start = r.LastEvaluatedKey;
    } while (start);
    return items;
  }
}
