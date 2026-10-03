import { CfnParameter, Stack, type StackProps } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import type { HandlerName } from '../../src/handlers/registry.js';
import { Data } from './data.js';
import { Flow } from './flow.js';

export interface DurableMultiAgentStackProps extends StackProps {
  readonly stage: 'aws' | 'local';
  /** How long the workflow waits for a human. Default 172800 (48 h). */
  readonly approvalTimeoutSeconds?: number;
  /** Local stage only. Default http://127.0.0.1:5333 */
  readonly agentUrl?: string;
  readonly slackChannelId?: string;
  /** Comma-separated Slack user ids allowed to approve. */
  readonly approverIds?: string;
  readonly maxOrderCents?: number;
  /** Default: aws bundles dist/lambda/<name>; local uses inline stubs because handlers run in-process. */
  readonly codeFor?: (name: HandlerName) => lambda.Code;
}

export class DurableMultiAgentStack extends Stack {
  readonly data: Data;
  readonly flow: Flow;

  constructor(scope: Construct, id: string, props: DurableMultiAgentStackProps) {
    super(scope, id, props);
    const codeFor = props.codeFor ?? ((name: HandlerName) =>
      props.stage === 'aws'
        ? lambda.Code.fromAsset(`dist/lambda/${name}`)
        : lambda.Code.fromInline('// runs in-process locally'));

    this.data = new Data(this, 'Data', { stage: props.stage });

    let agentRuntimeArn: string | undefined;
    if (props.stage === 'aws') {
      agentRuntimeArn = new CfnParameter(this, 'AgentRuntimeArn', {
        type: 'String',
        allowedPattern: '^arn:aws[a-z-]*:bedrock-agentcore:[a-z0-9-]+:[0-9]{12}:runtime/.+$',
        description: 'ARN of the AgentCore runtime that hosts the procurement agent',
      }).valueAsString;
    }

    this.flow = new Flow(this, 'Flow', {
      data: this.data,
      stage: props.stage,
      approvalTimeoutSeconds: props.approvalTimeoutSeconds ?? 172800,
      agentUrl: props.agentUrl ?? 'http://127.0.0.1:5333',
      agentRuntimeArn,
      slackChannelId: props.slackChannelId ?? 'C0APPROVALS',
      maxOrderCents: props.maxOrderCents ?? 1_000_000,
      codeFor,
    });
  }
}
