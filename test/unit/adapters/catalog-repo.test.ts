import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, BatchWriteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { CatalogRepo } from '../../../src/adapters/catalog-repo.js';
import { CATALOG_ITEMS } from '../fixtures.js';

const ddb = mockClient(DynamoDBDocumentClient);
const repo = new CatalogRepo(DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' })), 'Catalog');

beforeEach(() => ddb.reset());

describe('CatalogRepo', () => {
  it('getMany chunks keys by 100', async () => {
    ddb.on(BatchGetCommand).resolves({ Responses: { Catalog: [] } });
    await repo.getMany(Array.from({ length: 250 }, (_, i) => `S${i}`));
    const calls = ddb.commandCalls(BatchGetCommand);
    expect(calls.map((c) => c.args[0].input.RequestItems!.Catalog!.Keys!.length)).toEqual([100, 100, 50]);
  });

  it('getMany strips keys and indexes by sku', async () => {
    ddb.on(BatchGetCommand).resolves({ Responses: { Catalog: [{ pk: 'SKU#A', sk: 'ITEM', ...CATALOG_ITEMS[0]! }] } });
    const m = await repo.getMany([CATALOG_ITEMS[0]!.sku]);
    expect(m.get(CATALOG_ITEMS[0]!.sku)).toEqual(CATALOG_ITEMS[0]);
  });

  it('putAll chunks writes by 25', async () => {
    ddb.on(BatchWriteCommand).resolves({});
    const items = Array.from({ length: 60 }, (_, i) => ({ ...CATALOG_ITEMS[0]!, sku: `S${i}` }));
    await repo.putAll(items);
    expect(ddb.commandCalls(BatchWriteCommand).map((c) => c.args[0].input.RequestItems!.Catalog!.length)).toEqual([25, 25, 10]);
  });
});
