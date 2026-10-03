import { CfnOutput } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpIamAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';
import type { HandlerName } from '../../src/handlers/registry.js';
import type { Data } from './data.js';
import { handlerFunction } from './handler-function.js';

export interface ApiProps {
  readonly data: Data;
  readonly stateMachine: sfn.IStateMachine;
  readonly slackSecret: secretsmanager.ISecret;
  readonly approverIds: string;
  readonly codeFor: (name: HandlerName) => lambda.Code;
}

export class Api extends Construct {
  readonly httpApi: apigwv2.HttpApi;
  readonly startRun: lambda.Function;
  readonly getRun: lambda.Function;
  readonly slackInteractions: lambda.Function;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);
    const { data, stateMachine } = props;
    const fn = (fid: string, name: HandlerName, environment: Record<string, string>) =>
      handlerFunction(this, fid, { name, environment, codeFor: props.codeFor });

    this.startRun = fn('StartRunFn', 'start-run', {
      RUNS_TABLE: data.runs.tableName,
      STATE_MACHINE_ARN: stateMachine.stateMachineArn,
    });
    data.runs.grantReadWriteData(this.startRun);
    stateMachine.grantStartExecution(this.startRun);

    this.getRun = fn('GetRunFn', 'get-run', {
      RUNS_TABLE: data.runs.tableName,
      LEDGER_TABLE: data.ledger.tableName,
    });
    data.runs.grantReadData(this.getRun);
    data.ledger.grantReadData(this.getRun);

    this.slackInteractions = fn('SlackInteractionsFn', 'slack-interactions', {
      RUNS_TABLE: data.runs.tableName,
      STATE_MACHINE_ARN: stateMachine.stateMachineArn,
      SLACK_SECRET_ARN: props.slackSecret.secretArn,
      APPROVER_IDS: props.approverIds,
    });
    data.runs.grantReadWriteData(this.slackInteractions);
    stateMachine.grantTaskResponse(this.slackInteractions);
    props.slackSecret.grantRead(this.slackInteractions);

    this.httpApi = new apigwv2.HttpApi(this, 'ProcurementApi', { createDefaultStage: true });
    const iam = new HttpIamAuthorizer();
    this.httpApi.addRoutes({
      path: '/runs', methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('StartRunIntegration', this.startRun), authorizer: iam,
    });
    this.httpApi.addRoutes({
      path: '/runs/{runId}', methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetRunIntegration', this.getRun), authorizer: iam,
    });
    // Slack cannot sign with IAM. Its HMAC signature is verified inside the function (I6).
    this.httpApi.addRoutes({
      path: '/slack/interactions', methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('SlackIntegration', this.slackInteractions),
    });

    const accessLogs = new logs.LogGroup(this, 'ApiAccessLogs', { retention: logs.RetentionDays.ONE_MONTH });
    const stage = this.httpApi.defaultStage!.node.defaultChild as apigwv2.CfnStage;
    stage.accessLogSettings = {
      destinationArn: accessLogs.logGroupArn,
      format: JSON.stringify({
        requestId: '$context.requestId', ip: '$context.identity.sourceIp', route: '$context.routeKey',
        status: '$context.status', latency: '$context.responseLatency',
      }),
    };
    stage.defaultRouteSettings = { throttlingBurstLimit: 20, throttlingRateLimit: 10 };

    new CfnOutput(this, 'ApiUrl', { value: this.httpApi.apiEndpoint });
  }
}
