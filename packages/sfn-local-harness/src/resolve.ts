export interface ResolveContext {
  region: string;
  accountId: string;
  partition: string;
  urlSuffix: string;
  ref(logicalId: string): string;
  getAtt(logicalId: string, attribute: string): string;
}

type Json = unknown;

function pseudo(name: string, ctx: ResolveContext): string {
  switch (name) {
    case 'AWS::Region': return ctx.region;
    case 'AWS::AccountId': return ctx.accountId;
    case 'AWS::Partition': return ctx.partition;
    case 'AWS::URLSuffix': return ctx.urlSuffix;
    case 'AWS::StackName': return 'local';
    default: throw new Error(`Unsupported pseudo parameter ${name}`);
  }
}

function refOf(name: string, ctx: ResolveContext): string {
  return name.startsWith('AWS::') ? pseudo(name, ctx) : ctx.ref(name);
}

function getAttOf(arg: Json, ctx: ResolveContext): string {
  if (Array.isArray(arg)) return ctx.getAtt(String(arg[0]), String(resolveIntrinsics(arg[1], ctx)));
  const s = String(arg);
  const dot = s.indexOf('.');
  if (dot < 0) throw new Error(`Invalid Fn::GetAtt ${s}`);
  return ctx.getAtt(s.slice(0, dot), s.slice(dot + 1));
}

function subOf(template: string, ctx: ResolveContext): string {
  return template.replace(/\$\{([^}]+)\}/g, (_m, expr: string) => {
    if (expr.startsWith('!')) return `\${${expr.slice(1)}}`;
    if (expr.startsWith('AWS::')) return pseudo(expr, ctx);
    const dot = expr.indexOf('.');
    return dot >= 0 ? ctx.getAtt(expr.slice(0, dot), expr.slice(dot + 1)) : ctx.ref(expr);
  });
}

/** Resolves the CloudFormation intrinsics CDK emits for the resources a local run needs. Anything else throws. */
export function resolveIntrinsics(value: Json, ctx: ResolveContext): Json {
  if (Array.isArray(value)) return value.map((v) => resolveIntrinsics(v, ctx));
  if (value === null || typeof value !== 'object') return value;

  const obj = value as Record<string, Json>;
  const keys = Object.keys(obj);
  if (keys.length === 1) {
    const k = keys[0]!;
    const arg = obj[k];
    switch (k) {
      case 'Ref': return refOf(String(arg), ctx);
      case 'Fn::GetAtt': return getAttOf(arg, ctx);
      case 'Fn::Join': {
        const [delim, list] = arg as [string, Json[]];
        return (resolveIntrinsics(list, ctx) as Json[]).map(String).join(delim);
      }
      case 'Fn::Sub':
        if (typeof arg !== 'string') throw new Error('Unsupported intrinsic Fn::Sub (array form)');
        return subOf(arg, ctx);
      case 'Fn::Select': {
        const [index, list] = arg as [number | string, Json];
        return (resolveIntrinsics(list, ctx) as Json[])[Number(resolveIntrinsics(index, ctx))];
      }
      case 'Fn::Split': {
        const [delim, str] = arg as [string, Json];
        return String(resolveIntrinsics(str, ctx)).split(delim);
      }
      default:
        if (k.startsWith('Fn::')) throw new Error(`Unsupported intrinsic ${k}`);
    }
  }
  return Object.fromEntries(keys.map((k) => [k, resolveIntrinsics(obj[k], ctx)]));
}
