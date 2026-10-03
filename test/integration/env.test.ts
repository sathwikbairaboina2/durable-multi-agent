import { ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { DescribeStateMachineCommand } from '@aws-sdk/client-sfn';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startLocalEnv, type LocalEnv } from '../../src/local/env.js';

describe.skipIf(process.env.DMA_INTEGRATION !== '1')('local environment', () => {
  let env: LocalEnv;
  beforeAll(async () => { env = await startLocalEnv(); });
  afterAll(async () => { await env?.close(); });

  it('creates the four prefixed tables', async () => {
    const r = await env.doc.send(new ListTablesCommand({}));
    for (const t of Object.values(env.tables)) {
      expect(t.startsWith(env.prefix)).toBe(true);
      expect(r.TableNames).toContain(t);
    }
  });
  it('deploys the state machine', async () => {
    const d = await env.sfn.send(new DescribeStateMachineCommand({ stateMachineArn: env.stateMachineArn }));
    expect(d.status).toBe('ACTIVE');
  });
  it('has nine handlers', () => {
    expect(Object.keys(env.handlers)).toHaveLength(9);
  });
});
