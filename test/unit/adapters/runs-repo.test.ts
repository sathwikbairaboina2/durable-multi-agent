import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { RunsRepo } from '../../../src/adapters/runs-repo.js';
import type { StoredApproval } from '../../../src/adapters/ports.js';
import { IllegalTransition, InvalidProposal } from '../../../src/core/errors.js';
import { RUN_ID } from '../fixtures.js';

const ddb = mockClient(DynamoDBDocumentClient);
const repo = new RunsRepo(DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' })), 'Runs');
const condFail = () => new ConditionalCheckFailedException({ message: 'x', $metadata: {} });

beforeEach(() => ddb.reset());

describe('RunsRepo', () => {
  it('createRun puts META guarded by attribute_not_exists', async () => {
    ddb.on(PutCommand).resolves({});
    await repo.createRun({ runId: RUN_ID, requesterId: 'U0REQ1', request: 'r', nowIso: 'n' });
    const call = ddb.commandCalls(PutCommand)[0]!.args[0].input;
    expect(call.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(call.Item).toMatchObject({ pk: `RUN#${RUN_ID}`, sk: 'META', status: 'PLANNING' });
  });

  it('transition conditions on the prior status', async () => {
    ddb.on(UpdateCommand).resolves({});
    expect(await repo.transition('r', 'PLANNING', 'POLICY', 'n')).toBe(true);
    const input = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.ConditionExpression).toBe('#status = :from');
    expect(input.ExpressionAttributeValues).toMatchObject({ ':from': 'PLANNING', ':to': 'POLICY' });
  });

  it('transition returns false on ConditionalCheckFailed', async () => {
    ddb.on(UpdateCommand).rejects(condFail());
    expect(await repo.transition('r', 'PLANNING', 'POLICY', 'n')).toBe(false);
  });

  it('transition rejects illegal moves without sending', async () => {
    await expect(repo.transition('r', 'PLANNING', 'DONE', 'n')).rejects.toThrow(IllegalTransition);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('putProposal maps a failed condition to InvalidProposal', async () => {
    ddb.on(PutCommand).rejects(condFail());
    await expect(repo.putProposal('r', { proposal: {} as never, proposalHash: 'h', usage: { inputTokens: 0, outputTokens: 0, modelSteps: 0 } }))
      .rejects.toThrow(InvalidProposal);
  });

  it('createApproval sends one transaction with 3 items', async () => {
    ddb.on(TransactWriteCommand).resolves({});
    const a: StoredApproval = {
      runId: RUN_ID, approvalId: 'A1', proposalHash: 'h', totalCents: 1, pricedLines: [], state: 'PENDING', taskToken: 't', ttl: 1,
    };
    await repo.createApproval(a, 'n');
    const calls = ddb.commandCalls(TransactWriteCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input.TransactItems).toHaveLength(3);
  });

  it('decideApproval and expireApproval return false when the CAS loses', async () => {
    ddb.on(UpdateCommand).rejects(condFail());
    expect(await repo.decideApproval('r', 'A1', 'APPROVED', 'U', 'n')).toBe(false);
    expect(await repo.expireApproval('r', 'n')).toBe(false);
  });

  it('decideApproval conditions on PENDING and the approval id', async () => {
    ddb.on(UpdateCommand).resolves({});
    expect(await repo.decideApproval('r', 'A1', 'REJECTED', 'U', 'n')).toBe(true);
    expect(ddb.commandCalls(UpdateCommand)[0]!.args[0].input.ConditionExpression).toBe('#state = :pending AND approvalId = :id');
  });
});
