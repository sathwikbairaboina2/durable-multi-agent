import { BatchGetCommand, BatchWriteCommand, ScanCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { CatalogItem } from '../core/types.js';
import type { CatalogPort } from './ports.js';
import { catalogKey, stripKeys } from './tables.js';

const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

export class CatalogRepo implements CatalogPort {
  constructor(private readonly doc: DynamoDBDocumentClient, private readonly table: string) {}

  async getMany(skus: string[]): Promise<Map<string, CatalogItem>> {
    const out = new Map<string, CatalogItem>();
    for (const part of chunk([...new Set(skus)], 100)) {
      let keys: Array<Record<string, unknown>> | undefined = part.map(catalogKey);
      while (keys && keys.length > 0) {
        const r = await this.doc.send(new BatchGetCommand({ RequestItems: { [this.table]: { Keys: keys, ConsistentRead: true } } }));
        for (const item of r.Responses?.[this.table] ?? []) {
          const c = stripKeys(item) as unknown as CatalogItem;
          out.set(c.sku, c);
        }
        keys = r.UnprocessedKeys?.[this.table]?.Keys as Array<Record<string, unknown>> | undefined;
      }
    }
    return out;
  }

  async listActive(): Promise<CatalogItem[]> {
    const items: CatalogItem[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(new ScanCommand({
        TableName: this.table,
        FilterExpression: 'active = :t',
        ExpressionAttributeValues: { ':t': true },
        ExclusiveStartKey: start,
      }));
      for (const i of r.Items ?? []) items.push(stripKeys(i) as unknown as CatalogItem);
      start = r.LastEvaluatedKey;
    } while (start);
    return items.sort((a, b) => a.sku.localeCompare(b.sku));
  }

  async putAll(items: CatalogItem[]): Promise<void> {
    for (const part of chunk(items, 25)) {
      let reqs: Array<{ PutRequest: { Item: Record<string, unknown> } }> | undefined = part.map((i) => ({
        PutRequest: { Item: { ...catalogKey(i.sku), ...i } },
      }));
      while (reqs && reqs.length > 0) {
        const r = await this.doc.send(new BatchWriteCommand({ RequestItems: { [this.table]: reqs } }));
        reqs = r.UnprocessedItems?.[this.table] as typeof reqs | undefined;
      }
    }
  }
}
