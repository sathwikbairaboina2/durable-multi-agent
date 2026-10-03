import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { LedgerRepo } from '../../../src/adapters/ledger-repo.js';
import { planExecution } from '../../../src/core/execute.js';
import { proposalHash } from '../../../src/core/hash.js';
import { RUN_ID, validOrder } from '../fixtures.js';

const ddb = mockClient(DynamoDBDocumentClient);
const repo = new LedgerRepo(DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' })), { runs: 'Runs', budgets: 'Budgets', ledger: 'Ledger' });

const plan = (() => {
  const p = planExecution({
    runId: RUN_ID, requesterId: 'U0REQ1', storedProposal: validOrder(),
    approval: { state: 'APPROVED', proposalHash: proposalHash(validOrder()), decidedBy: 'U0A', totalCents: 869700, pricedLines: [] },
    budget: { limitCents: 1_500_000, spentCents: 0 }, nowIso: 'n',
  });
  if (!p.ok) throw new Error('fixture plan must be ok');
  return p;
})();
const args = { runId: RUN_ID, requesterId: 'U0REQ1', month: '2026-10', nowIso: 'n' };
const cancel = (codes: string[]) =>
  new TransactionCanceledException({ message: 'x', $metadata: {}, CancellationReasons: codes.map((Code) => ({ Code })) });

beforeEach(() => ddb.reset());

describe('LedgerRepo.execute', () => {
  it('sends the four items in the documented order', async () => {
    ddb.on(TransactWriteCommand).resolves({});
    expect(await repo.execute(plan, args)).toEqual({ kind: 'written' });
    const items = ddb.commandCalls(TransactWriteCommand)[0]!.args[0].input.TransactItems!;
    expect(items).toHaveLength(4);
    expect(items[0]!.ConditionCheck!.TableName).toBe('Runs');
    expect(items[1]!.Put!.TableName).toBe('Ledger');
    expect(items[1]!.Put!.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(items[2]!.Update!.TableName).toBe('Budgets');
    expect(items[2]!.Update!.ConditionExpression).toBe('limitCents = :lim AND spentCents <= :maxBefore');
    expect(items[2]!.Update!.ExpressionAttributeValues).toMatchObject({ ':t': 869700, ':lim': 1_500_000, ':maxBefore': 630300 });
    expect(items[3]!.Update!.TableName).toBe('Runs');
  });

  it('maps a ledger condition failure to ledger-exists', async () => {
    ddb.on(TransactWriteCommand).rejects(cancel(['None', 'ConditionalCheckFailed', 'None', 'ConditionalCheckFailed']));
    expect(await repo.execute(plan, args)).toEqual({ kind: 'ledger-exists' });
  });

  it('maps an approval condition failure to NotApproved', async () => {
    ddb.on(TransactWriteCommand).rejects(cancel(['ConditionalCheckFailed', 'None', 'None', 'None']));
    await expect(repo.execute(plan, args)).rejects.toMatchObject({ name: 'NotApproved' });
  });

  it('maps a budget condition failure to BudgetExhausted', async () => {
    ddb.on(TransactWriteCommand).rejects(cancel(['None', 'None', 'ConditionalCheckFailed', 'None']));
    await expect(repo.execute(plan, args)).rejects.toMatchObject({ name: 'BudgetExhausted' });
  });

  it('rethrows a transaction conflict so the workflow retries', async () => {
    ddb.on(TransactWriteCommand).rejects(cancel(['None', 'None', 'None', 'TransactionConflict']));
    await expect(repo.execute(plan, args)).rejects.toMatchObject({ name: 'TransactionCanceledException' });
  });
});
