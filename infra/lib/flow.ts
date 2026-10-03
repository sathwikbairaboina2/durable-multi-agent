import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';
import type { HandlerName } from '../../src/handlers/registry.js';
import type { Data } from './data.js';
import { buildDefinition, type FlowFunctions } from './definition.js';
import { handlerFunction } from './handler-function.js';

export interface FlowProps {
  readonly data: Data;
  readonly stage: 'aws' | 'local';
  readonly approvalTimeoutSeconds: number;
  readonly agentUrl: string;
  /** aws stage: the AgentRuntimeArn parameter's value (a token). */
  readonly agentRuntimeArn?: string;
  readonly slackChannelId: string;
  readonly maxOrderCents: number;
  readonly codeFor: (name: HandlerName) => lambda.Code;
}

export class Flow extends Construct {
  readonly stateMachine: sfn.StateMachine;
  readonly functions: FlowFunctions;
  readonly slackSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: FlowProps) {
    super(scope, id);
    const { data } = props;

    this.slackSecret = new secretsmanager.Secret(this, 'SlackSecret', {
      description: 'Slack bot token and signing secret. Replace botToken after deploy.',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ botToken: 'set-me' }),
        generateStringKey: 'signingSecret',
      },
      removalPolicy: props.stage === 'aws' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    const fn = (fid: string, name: HandlerName, environment: Record<string, string>, extra: { timeout?: Duration; memorySize?: number } = {}) =>
      handlerFunction(this, fid, { name, environment, codeFor: props.codeFor, ...extra });

    const invokeAgent = fn('InvokeAgentFn', 'invoke-agent', {
      CATALOG_TABLE: data.catalog.tableName,
      ...(props.stage === 'aws' ? { AGENT_RUNTIME_ARN: props.agentRuntimeArn! } : { AGENT_URL: props.agentUrl }),
    }, { timeout: Duration.minutes(5), memorySize: 512 });
    data.catalog.grantReadData(invokeAgent);
    if (props.stage === 'aws') {
      invokeAgent.addToRolePolicy(new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [props.agentRuntimeArn!, `${props.agentRuntimeArn!}/*`],
      }));
    }

    const persistProposal = fn('PersistProposalFn', 'persist-proposal', { RUNS_TABLE: data.runs.tableName });
    data.runs.grantReadWriteData(persistProposal);

    const policyCheck = fn('PolicyCheckFn', 'policy-check', {
      RUNS_TABLE: data.runs.tableName,
      CATALOG_TABLE: data.catalog.tableName,
      BUDGETS_TABLE: data.budgets.tableName,
      MAX_ORDER_CENTS: String(props.maxOrderCents),
    });
    data.runs.grantReadData(policyCheck);
    data.catalog.grantReadData(policyCheck);
    data.budgets.grantReadData(policyCheck);

    const requestApproval = fn('RequestApprovalFn', 'request-approval', {
      RUNS_TABLE: data.runs.tableName,
      SLACK_SECRET_ARN: this.slackSecret.secretArn,
      SLACK_CHANNEL_ID: props.slackChannelId,
      APPROVAL_TTL_SECONDS: String(props.approvalTimeoutSeconds + 86400),
    });
    data.runs.grantReadWriteData(requestApproval);
    this.slackSecret.grantRead(requestApproval);

    const executePo = fn('ExecutePoFn', 'execute-po', {
      RUNS_TABLE: data.runs.tableName,
      BUDGETS_TABLE: data.budgets.tableName,
      LEDGER_TABLE: data.ledger.tableName,
    });
    data.runs.grantReadWriteData(executePo);
    data.budgets.grantReadWriteData(executePo);
    data.ledger.grantReadWriteData(executePo);

    const finalize = fn('FinalizeFn', 'finalize', {
      RUNS_TABLE: data.runs.tableName,
      SLACK_SECRET_ARN: this.slackSecret.secretArn,
    });
    data.runs.grantReadWriteData(finalize);
    this.slackSecret.grantRead(finalize);

    this.functions = { invokeAgent, persistProposal, policyCheck, requestApproval, executePo, finalize };

    this.stateMachine = new sfn.StateMachine(this, 'ProcurementFlow', {
      definitionBody: sfn.DefinitionBody.fromChainable(
        buildDefinition(this, this.functions, { approvalTimeoutSeconds: props.approvalTimeoutSeconds }),
      ),
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: Duration.seconds(props.approvalTimeoutSeconds + 3600),
      tracingEnabled: true,
      logs: {
        destination: new logs.LogGroup(this, 'FlowLogs', { retention: logs.RetentionDays.ONE_MONTH }),
        level: sfn.LogLevel.ALL,
        // Task tokens travel in execution data, so keep it out of the logs (I11).
        includeExecutionData: false,
      },
    });
  }
}
