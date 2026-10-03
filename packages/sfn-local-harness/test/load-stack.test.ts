import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadStack } from '../src/load-stack.js';

const template = JSON.parse(readFileSync(new URL('./fixtures/template.json', import.meta.url), 'utf8'));
const stack = () => loadStack(template, { prefix: 't1' });

describe('loadStack', () => {
  it('loads functions with arn, name and resolved environment', () => {
    const f = stack().functions.find((x) => x.logicalId === 'Fn1')!;
    expect(f.name).toBe('t1Fn1');
    expect(f.arn).toBe('arn:aws:lambda:us-east-1:123456789012:function:t1Fn1');
    expect(f.environment).toEqual({
      TABLE: 't1Table1',
      TABLE_ARN: 'arn:aws:dynamodb:us-east-1:123456789012:table/t1Table1',
      LABEL: 'us-east-1-t1Table1',
      PLAIN: 'x',
    });
  });
  it('loads tables for DynamoDB Local', () => {
    const t = stack().tables[0]!;
    expect(t.createTableInput.TableName).toBe('t1Table1');
    expect(t.createTableInput.BillingMode).toBe('PAY_PER_REQUEST');
    expect(t.createTableInput.KeySchema).toHaveLength(2);
    expect(t.createTableInput.AttributeDefinitions).toHaveLength(2);
    expect(t.createTableInput.SSESpecification).toBeUndefined();
    expect(t.createTableInput.PointInTimeRecoverySpecification).toBeUndefined();
    expect(t.ttlAttribute).toBe('ttl');
  });
  it('resolves the state machine definition to ASL with the function ARNs', () => {
    const s = stack();
    const sm = s.stateMachines[0]!;
    expect(sm.name).toBe('t1Sm1');
    expect(sm.arn).toBe('arn:aws:states:us-east-1:123456789012:stateMachine:t1Sm1');
    const asl = JSON.parse(sm.definition);
    expect(asl.States.A.Resource).toBe('arn:aws:states:::lambda:invoke');
    expect(asl.States.A.Parameters.FunctionName).toBe(s.functions.find((f) => f.logicalId === 'Fn1')!.arn);
  });
  it('resolves a Ref to the state machine as its ARN', () => {
    const f = stack().functions.find((x) => x.logicalId === 'Fn3')!;
    expect(f.environment.SM).toBe('arn:aws:states:us-east-1:123456789012:stateMachine:t1Sm1');
  });
  it('throws on a reference to an unknown resource', () => {
    const bad = { Resources: { F: { Type: 'AWS::Lambda::Function', Properties: { Environment: { Variables: { X: { Ref: 'Nope' } } } } } } };
    expect(() => loadStack(bad, { prefix: 'p' })).toThrow('Unknown resource Nope');
  });
});
