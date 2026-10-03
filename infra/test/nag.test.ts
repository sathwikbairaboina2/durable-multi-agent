import { App, Validations } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { AwsSolutionsChecks } from 'cdk-nag';
import { describe, expect, it } from 'vitest';
import { applyNagSuppressions } from '../lib/nag.js';
import { DurableMultiAgentStack } from '../lib/stack.js';

function build(acknowledge: boolean): App {
  const app = new App({ outdir: undefined });
  const stack = new DurableMultiAgentStack(app, 'NagStack', {
    stage: 'aws', codeFor: () => lambda.Code.fromInline('x'), approverIds: 'U0APPROVER1',
  });
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  if (acknowledge) applyNagSuppressions(stack);
  return app;
}

describe('cdk-nag AwsSolutions', () => {
  it('passes after the documented acknowledgements', () => {
    expect(() => build(true).synth()).not.toThrow();
  });
  it('fails without them (the check is live)', () => {
    expect(() => build(false).synth()).toThrow();
  });
});
