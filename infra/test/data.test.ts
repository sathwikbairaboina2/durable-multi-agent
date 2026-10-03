import { Match } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { synth } from './helpers.js';

describe('Data construct', () => {
  const t = synth();

  it('creates four tables, all PITR-enabled and on-demand', () => {
    t.resourceCountIs('AWS::DynamoDB::Table', 4);
    const tables = Object.values(t.findResources('AWS::DynamoDB::Table'));
    for (const r of tables) {
      expect(r.Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled).toBe(true);
      expect(r.Properties.BillingMode).toBe('PAY_PER_REQUEST');
    }
  });

  it('encrypts Runs with a customer-managed key and expires approvals via ttl', () => {
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      SSESpecification: { SSEEnabled: true, SSEType: 'KMS', KMSMasterKeyId: Match.anyValue() },
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });

  it('rotates the KMS key', () => {
    t.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
  });

  it('retains data in the aws stage', () => {
    for (const r of Object.values(t.findResources('AWS::DynamoDB::Table'))) expect(r.DeletionPolicy).toBe('Retain');
  });

  it('local stage destroys tables and has no parameters', () => {
    const local = synth({ stage: 'local' }).toJSON();
    for (const r of Object.values(synth({ stage: 'local' }).findResources('AWS::DynamoDB::Table'))) expect(r.DeletionPolicy).toBe('Delete');
    expect(local.Parameters?.AgentRuntimeArn).toBeUndefined();
    expect(t.toJSON().Parameters.AgentRuntimeArn).toBeDefined();
  });
});
