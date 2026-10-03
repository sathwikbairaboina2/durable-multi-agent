import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { DurableMultiAgentStack, type DurableMultiAgentStackProps } from '../lib/stack.js';

export function synthStack(props: Partial<DurableMultiAgentStackProps> = {}): { stack: DurableMultiAgentStack; template: Template } {
  const app = new App();
  const stack = new DurableMultiAgentStack(app, 'TestStack', {
    stage: 'aws',
    codeFor: () => lambda.Code.fromInline('x'),
    ...props,
  });
  return { stack, template: Template.fromStack(stack) };
}

export const synth = (props: Partial<DurableMultiAgentStackProps> = {}): Template => synthStack(props).template;
