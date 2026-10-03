import { Duration } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import type { HandlerName } from '../../src/handlers/registry.js';

export interface HandlerFunctionProps {
  readonly name: HandlerName;
  readonly environment?: Record<string, string>;
  readonly codeFor: (name: HandlerName) => lambda.Code;
  readonly timeout?: Duration;
  readonly memorySize?: number;
}

/** One Lambda function per handler. DMA_HANDLER names the handler so the local host can find its code. */
export function handlerFunction(scope: Construct, id: string, props: HandlerFunctionProps): lambda.Function {
  return new lambda.Function(scope, id, {
    runtime: lambda.Runtime.NODEJS_24_X,
    architecture: lambda.Architecture.ARM_64,
    handler: 'index.handler',
    code: props.codeFor(props.name),
    tracing: lambda.Tracing.ACTIVE,
    memorySize: props.memorySize ?? 256,
    timeout: props.timeout ?? Duration.seconds(30),
    logGroup: new logs.LogGroup(scope, `${id}Logs`, { retention: logs.RetentionDays.ONE_MONTH }),
    environment: {
      DMA_HANDLER: props.name,
      NODE_OPTIONS: '--enable-source-maps',
      ...props.environment,
    },
  });
}
