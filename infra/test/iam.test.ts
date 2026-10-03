import { describe, expect, it } from 'vitest';
import { synth } from './helpers.js';

interface Statement { Action: string | string[]; Resource: unknown; Effect: string }
interface PolicyInfo { roles: string[]; statements: Statement[] }

const template = synth();
const tables = template.findResources('AWS::DynamoDB::Table');
const ledgerLogicalId = Object.keys(tables).find((k) => k.includes('LedgerTable'))!;

const policies: PolicyInfo[] = Object.values(template.findResources('AWS::IAM::Policy')).map((p: any) => ({
  roles: (p.Properties.Roles as Array<{ Ref: string }>).map((r) => r.Ref),
  statements: p.Properties.PolicyDocument.Statement as Statement[],
}));
const actionsOf = (s: Statement): string[] => (Array.isArray(s.Action) ? s.Action : [s.Action]);
const rolesWith = (pred: (s: Statement) => boolean): string[] =>
  [...new Set(policies.filter((p) => p.statements.some(pred)).flatMap((p) => p.roles))];

describe('IAM invariants (I12)', () => {
  it('only InvokeAgentFn may call the agent runtime, with exactly one statement', () => {
    const pred = (s: Statement) => actionsOf(s).includes('bedrock-agentcore:InvokeAgentRuntime');
    const roles = rolesWith(pred);
    expect(roles).toHaveLength(1);
    expect(roles[0]).toContain('InvokeAgentFn');
    expect(policies.flatMap((p) => p.statements).filter(pred)).toHaveLength(1);
  });

  it('only ExecutePoFn may write the ledger table', () => {
    const writes = ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:BatchWriteItem'];
    const pred = (s: Statement) =>
      actionsOf(s).some((a) => writes.includes(a)) && JSON.stringify(s.Resource).includes(ledgerLogicalId);
    const roles = rolesWith(pred);
    expect(roles.length).toBeGreaterThan(0);
    for (const r of roles) expect(r).toContain('FlowExecutePoFn');
  });

  it('only SlackInteractionsFn may resume the workflow', () => {
    const roles = rolesWith((s) => actionsOf(s).includes('states:SendTaskSuccess'));
    expect(roles).toHaveLength(1);
    expect(roles[0]).toContain('SlackInteractionsFn');
  });

  it('no statement grants Action * or <service>:*', () => {
    for (const p of policies) {
      for (const s of p.statements) {
        for (const a of actionsOf(s)) {
          expect(a).not.toBe('*');
          expect(a.endsWith(':*')).toBe(false);
        }
      }
    }
  });
});
