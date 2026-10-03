import { resolveIntrinsics } from 'sfn-local-harness';
import { describe, expect, it } from 'vitest';
import { synth } from './helpers.js';

function definition(props: Parameters<typeof synth>[0] = {}): { asl: any; template: ReturnType<typeof synth> } {
  const template = synth(props);
  const sm = Object.values(template.findResources('AWS::StepFunctions::StateMachine'))[0]!;
  const ctx = {
    region: 'us-east-1', accountId: '123456789012', partition: 'aws', urlSuffix: 'amazonaws.com',
    ref: (id: string) => id, getAtt: (id: string, attr: string) => `${id}.${attr}`,
  };
  const str = resolveIntrinsics(sm.Properties.DefinitionString, ctx) as string;
  return { asl: JSON.parse(str), template };
}

describe('ProcurementFlow definition', () => {
  const { asl, template } = definition();

  it('I8: bounds the approval wait (default 48 h, configurable)', () => {
    expect(asl.States.RequestApproval.TimeoutSeconds).toBe(172800);
    expect(definition({ approvalTimeoutSeconds: 5 }).asl.States.RequestApproval.TimeoutSeconds).toBe(5);
  });

  it('waits for a task token and passes it to the function', () => {
    const s = asl.States.RequestApproval;
    expect(s.Resource.endsWith(':states:::lambda:invoke.waitForTaskToken')).toBe(true);
    expect(s.Parameters.Payload['taskToken.$']).toBe('$$.Task.Token');
  });

  it('routes timeout, human rejection and everything else, in that order', () => {
    const c = asl.States.RequestApproval.Catch.map((x: any) => [x.ErrorEquals[0], x.Next]);
    expect(c).toEqual([['States.Timeout', 'MarkExpired'], ['HumanRejected', 'MarkRejectedByHuman'], ['States.ALL', 'MarkFailed']]);
  });

  it('does not retry business errors on ExecutePO before the catch-all retry', () => {
    const r = asl.States.ExecutePO.Retry as Array<{ ErrorEquals: string[]; MaxAttempts?: number }>;
    const business = r.findIndex((x) => x.ErrorEquals.includes('BudgetExhausted'));
    const all = r.findIndex((x) => x.ErrorEquals.includes('States.ALL'));
    expect(business).toBeGreaterThanOrEqual(0);
    expect(business).toBeLessThan(all);
    expect(r[business]!.MaxAttempts).toBe(0);
    expect(r[all]!.MaxAttempts).toBe(3);
  });

  it('only references $.error in states reached through a Catch', () => {
    const caught = new Set<string>();
    for (const s of Object.values<any>(asl.States)) for (const c of s.Catch ?? []) caught.add(c.Next);
    for (const [name, s] of Object.entries<any>(asl.States)) {
      const usesError = JSON.stringify(s.Parameters ?? {}).includes('$.error');
      if (usesError) expect(caught.has(name)).toBe(true);
    }
    expect(JSON.stringify(asl.States.MarkDone)).not.toContain('$.error');
    expect(JSON.stringify(asl.States.MarkRejectedByPolicy)).not.toContain('$.error');
  });

  it('stores caught errors under $.error', () => {
    for (const s of Object.values<any>(asl.States)) for (const c of s.Catch ?? []) expect(c.ResultPath).toBe('$.error');
  });

  it('tags every function with its handler name', () => {
    const names = Object.values(template.findResources('AWS::Lambda::Function')).map((r: any) => r.Properties.Environment.Variables.DMA_HANDLER);
    expect(new Set(names)).toEqual(new Set(['invoke-agent', 'persist-proposal', 'policy-check', 'request-approval', 'execute-po', 'finalize']));
  });

  it('traces and logs the state machine without execution data (I11)', () => {
    template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
      TracingConfiguration: { Enabled: true },
      LoggingConfiguration: { Level: 'ALL', IncludeExecutionData: false },
    });
  });

  it('uses the direct-ARN form for non-waiting tasks', () => {
    expect(asl.States.InvokeAgentTeam.Resource).toContain('InvokeAgentFn');
    expect(asl.States.InvokeAgentTeam.Parameters).toEqual({ 'runId.$': '$.runId', 'request.$': '$.request' });
  });
});
