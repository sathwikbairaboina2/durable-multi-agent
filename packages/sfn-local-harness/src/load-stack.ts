import { resolveIntrinsics, type ResolveContext } from './resolve.js';

export interface CfnTemplate { Resources?: Record<string, { Type: string; Properties?: Record<string, any> }> }

export interface LoadedFunction {
  logicalId: string;
  name: string;
  arn: string;
  environment: Record<string, string>;
}
export interface LoadedTable {
  logicalId: string;
  name: string;
  createTableInput: Record<string, any>;
  ttlAttribute?: string;
}
export interface LoadedStateMachine {
  logicalId: string;
  name: string;
  arn: string;
  /** The Amazon States Language definition, as the JSON string the template resolves to. */
  definition: string;
}
export interface LoadedStack {
  prefix: string;
  region: string;
  accountId: string;
  functions: LoadedFunction[];
  tables: LoadedTable[];
  stateMachines: LoadedStateMachine[];
  resolve(value: unknown): unknown;
}
export interface LoadStackOptions { prefix: string; region?: string; accountId?: string }

export function loadStack(template: CfnTemplate, opts: LoadStackOptions): LoadedStack {
  const region = opts.region ?? 'us-east-1';
  const accountId = opts.accountId ?? '123456789012';
  const resources = template.Resources ?? {};
  const nameOf = (id: string) => `${opts.prefix}${id}`;

  const need = (id: string) => {
    const r = resources[id];
    if (!r) throw new Error(`Unknown resource ${id}`);
    return r;
  };
  const arnOf = (id: string): string => {
    const r = need(id);
    switch (r.Type) {
      case 'AWS::DynamoDB::Table': return `arn:aws:dynamodb:${region}:${accountId}:table/${nameOf(id)}`;
      case 'AWS::Lambda::Function': return `arn:aws:lambda:${region}:${accountId}:function:${nameOf(id)}`;
      case 'AWS::StepFunctions::StateMachine': return `arn:aws:states:${region}:${accountId}:stateMachine:${nameOf(id)}`;
      default: return `arn:aws:local:${region}:${accountId}:${id}`;
    }
  };

  const ctx: ResolveContext = {
    region, accountId, partition: 'aws', urlSuffix: 'amazonaws.com',
    ref(id) {
      const r = need(id);
      return r.Type === 'AWS::StepFunctions::StateMachine' ? arnOf(id) : nameOf(id);
    },
    getAtt(id, attr) {
      need(id);
      return attr === 'Arn' ? arnOf(id) : `${nameOf(id)}.${attr}`;
    },
  };
  const resolve = (v: unknown) => resolveIntrinsics(v, ctx);

  const functions: LoadedFunction[] = [];
  const tables: LoadedTable[] = [];
  const stateMachines: LoadedStateMachine[] = [];

  for (const [id, r] of Object.entries(resources)) {
    const props = r.Properties ?? {};
    if (r.Type === 'AWS::Lambda::Function') {
      const vars = (resolve(props.Environment?.Variables ?? {}) as Record<string, unknown>);
      functions.push({
        logicalId: id, name: nameOf(id), arn: arnOf(id),
        environment: Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, String(v)])),
      });
    } else if (r.Type === 'AWS::DynamoDB::Table') {
      const input: Record<string, any> = {
        TableName: nameOf(id),
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: props.KeySchema,
        AttributeDefinitions: props.AttributeDefinitions,
      };
      if (props.GlobalSecondaryIndexes) input.GlobalSecondaryIndexes = props.GlobalSecondaryIndexes;
      const ttl = props.TimeToLiveSpecification;
      tables.push({
        logicalId: id, name: nameOf(id), createTableInput: input,
        ...(ttl?.Enabled ? { ttlAttribute: String(ttl.AttributeName) } : {}),
      });
    } else if (r.Type === 'AWS::StepFunctions::StateMachine') {
      let definition = resolve(props.DefinitionString) as string;
      const subs = (props.DefinitionSubstitutions ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(subs)) definition = definition.split(`\${${k}}`).join(String(resolve(v)));
      JSON.parse(definition); // fail early if the template does not resolve to valid ASL
      stateMachines.push({ logicalId: id, name: nameOf(id), arn: arnOf(id), definition });
    }
  }

  return { prefix: opts.prefix, region, accountId, functions, tables, stateMachines, resolve };
}
