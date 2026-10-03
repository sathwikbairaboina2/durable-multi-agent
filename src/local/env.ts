import { DynamoDBClient, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SFNClient } from '@aws-sdk/client-sfn';
import { App } from 'aws-cdk-lib';
import {
  deployStateMachine, deployTables, loadStack, startLambdaHost, waitForDynamoDbLocal, waitForStepFunctionsLocal,
  type LambdaHost,
} from 'sfn-local-harness';
import { DurableMultiAgentStack } from '../../infra/lib/stack.js';
import { BudgetsRepo } from '../adapters/budgets-repo.js';
import { CatalogRepo } from '../adapters/catalog-repo.js';
import type { AgentClient } from '../adapters/agent-client.js';
import { LedgerRepo } from '../adapters/ledger-repo.js';
import { RunsRepo } from '../adapters/runs-repo.js';
import type { BudgetsPort, CatalogPort, LedgerPort, RunsPort } from '../adapters/ports.js';
import { HANDLER_NAMES, REGISTRY, type HandlerName } from '../handlers/registry.js';
import { makeInvokeAgentHandler } from '../handlers/invoke-agent.js';
import { startSlackSink, type SlackSink } from './slack-sink.js';

export const LOCAL_SIGNING_SECRET = 'local-signing-secret';
export const DDB_ENDPOINT = 'http://127.0.0.1:5330';
export const SFN_ENDPOINT = 'http://127.0.0.1:5332';

export type Handler = (event: any) => Promise<any>;

export interface LocalEnvOptions {
  prefix?: string;
  approvalTimeoutSeconds?: number;
  agentClient?: AgentClient;
  wrapHandler?: (name: HandlerName, h: Handler) => Handler;
  approverIds?: string;
  slackPort?: number;
  lambdaPort?: number;
  maxOrderCents?: number;
}

export interface LocalEnv {
  prefix: string;
  stateMachineArn: string;
  tables: { runs: string; catalog: string; budgets: string; ledger: string };
  handlers: Record<HandlerName, Handler>;
  slack: SlackSink;
  lambdaHost: LambdaHost;
  doc: DynamoDBDocumentClient;
  sfn: SFNClient;
  runs: RunsPort;
  catalog: CatalogPort;
  budgets: BudgetsPort;
  ledger: LedgerPort;
  close(): Promise<void>;
}

/** Deploys the synthesized local-stage stack to DynamoDB Local and Step Functions Local and hosts its handlers in-process. */
export async function startLocalEnv(opts: LocalEnvOptions = {}): Promise<LocalEnv> {
  // Force the local AWS environment; never read real credentials.
  process.env.AWS_REGION = 'us-east-1';
  process.env.AWS_ACCESS_KEY_ID = 'test';
  process.env.AWS_SECRET_ACCESS_KEY = 'test';
  process.env.AWS_ENDPOINT_URL_DYNAMODB = DDB_ENDPOINT;
  process.env.AWS_ENDPOINT_URL_SFN = SFN_ENDPOINT;

  const prefix = opts.prefix ?? `dma${Date.now().toString(36)}`;
  const slackPort = opts.slackPort ?? 5334;
  const lambdaPort = opts.lambdaPort ?? 5331;

  const app = new App();
  new DurableMultiAgentStack(app, 'DurableMultiAgentStack', {
    stage: 'local',
    approvalTimeoutSeconds: opts.approvalTimeoutSeconds ?? 172800,
    approverIds: opts.approverIds ?? 'U0APPROVER1,U0APPROVER2',
    maxOrderCents: opts.maxOrderCents ?? 1_000_000,
  });
  const template = app.synth().getStackByName('DurableMultiAgentStack').template;
  const stack = loadStack(template, { prefix });

  const ddbClient = new DynamoDBClient({ region: 'us-east-1', endpoint: DDB_ENDPOINT });
  const sfn = new SFNClient({ region: 'us-east-1', endpoint: SFN_ENDPOINT });
  await waitForDynamoDbLocal(ddbClient);
  await waitForStepFunctionsLocal(sfn);
  await deployTables(ddbClient, stack.tables);
  const stateMachineArn = await deployStateMachine(sfn, stack.stateMachines[0]!);

  const doc = DynamoDBDocumentClient.from(ddbClient, { marshallOptions: { removeUndefinedValues: true } });
  const slack = await startSlackSink({ port: slackPort });
  const byFunctionName = new Map<string, Handler>();
  const handlers = {} as Record<HandlerName, Handler>;
  let tableEnv: Record<string, string> = {};

  for (const fn of stack.functions) {
    const name = fn.environment.DMA_HANDLER as HandlerName;
    if (!HANDLER_NAMES.includes(name)) continue;
    const env: Record<string, string> = {
      ...fn.environment,
      SLACK_SIGNING_SECRET: LOCAL_SIGNING_SECRET,
      SLACK_BOT_TOKEN: 'xoxb-local-fake',
      SLACK_API_BASE: `${slack.url}/api`,
      DDB_ENDPOINT,
      SFN_ENDPOINT,
      AWS_REGION: 'us-east-1',
    };
    tableEnv = { ...tableEnv, ...Object.fromEntries(Object.entries(env).filter(([k]) => k.endsWith('_TABLE'))) };
    let h: Handler;
    if (name === 'invoke-agent' && opts.agentClient) {
      h = makeInvokeAgentHandler({
        agent: opts.agentClient,
        catalog: new CatalogRepo(doc, env.CATALOG_TABLE!),
      });
    } else {
      h = await REGISTRY[name].fromEnv(env);
    }
    h = opts.wrapHandler ? opts.wrapHandler(name, h) : h;
    handlers[name] = h;
    byFunctionName.set(fn.name, h);
  }

  const lambdaHost = await startLambdaHost({ port: lambdaPort, resolve: (n) => byFunctionName.get(n) });

  const tables = {
    runs: tableEnv.RUNS_TABLE!, catalog: tableEnv.CATALOG_TABLE!, budgets: tableEnv.BUDGETS_TABLE!, ledger: tableEnv.LEDGER_TABLE!,
  };

  return {
    prefix, stateMachineArn, tables, handlers, slack, lambdaHost, doc, sfn,
    runs: new RunsRepo(doc, tables.runs),
    catalog: new CatalogRepo(doc, tables.catalog),
    budgets: new BudgetsRepo(doc, tables.budgets),
    ledger: new LedgerRepo(doc, tables),
    async close() {
      await lambdaHost.close();
      await slack.close();
      for (const t of Object.values(tables)) {
        try { await ddbClient.send(new DeleteTableCommand({ TableName: t })); } catch { /* already gone */ }
      }
    },
  };
}
