import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Env } from '../config.js';

/** Builds a document client. DDB_ENDPOINT points it at DynamoDB Local. */
export function makeDocClient(env: Env): DynamoDBDocumentClient {
  const endpoint = env.DDB_ENDPOINT || undefined;
  const base = new DynamoDBClient({
    region: env.AWS_REGION || 'us-east-1',
    ...(endpoint ? { endpoint } : {}),
  });
  return DynamoDBDocumentClient.from(base, { marshallOptions: { removeUndefinedValues: true } });
}

export function isConditionFailed(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'ConditionalCheckFailedException';
}
