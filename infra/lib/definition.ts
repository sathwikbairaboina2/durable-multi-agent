import { Duration } from 'aws-cdk-lib';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export interface FlowFunctions {
  invokeAgent: lambda.IFunction;
  persistProposal: lambda.IFunction;
  policyCheck: lambda.IFunction;
  requestApproval: lambda.IFunction;
  executePo: lambda.IFunction;
  finalize: lambda.IFunction;
}

/**
 * The ProcurementFlow state machine (spec: "State machine ProcurementFlow").
 * Every caught error is stored under $.error so the original input survives.
 * Finalize tasks reached without an error never reference $.error.
 */
export function buildDefinition(
  scope: Construct,
  fns: FlowFunctions,
  opts: { approvalTimeoutSeconds: number },
): sfn.IChainable {
  const direct = (id: string, fn: lambda.IFunction, payload: Record<string, unknown>, resultPath: string) =>
    new tasks.LambdaInvoke(scope, id, {
      lambdaFunction: fn,
      payload: sfn.TaskInput.fromObject(payload),
      payloadResponseOnly: true,
      resultPath,
    });

  const finalize = (id: string, outcome: string, withError: boolean) =>
    direct(id, fns.finalize, { 'runId.$': '$.runId', outcome, ...(withError ? { 'error.$': '$.error' } : {}) }, '$.final');

  const finished = new sfn.Succeed(scope, 'Finished');
  const failed = new sfn.Fail(scope, 'Failed', { error: 'RunFailed' });

  const markDone = finalize('MarkDone', 'DONE', false);
  const markRejectedByPolicy = finalize('MarkRejectedByPolicy', 'REJECTED_BY_POLICY', false);
  const markFailed = finalize('MarkFailed', 'FAILED', true);
  const markExpired = finalize('MarkExpired', 'EXPIRED', true);
  const markRejectedByHuman = finalize('MarkRejectedByHuman', 'REJECTED_BY_HUMAN', true);
  markDone.next(finished);
  markRejectedByPolicy.next(finished);
  markExpired.next(finished);
  markRejectedByHuman.next(finished);
  markFailed.next(failed);

  const catchAll = { errors: ['States.ALL'], resultPath: '$.error' };

  const invokeAgent = direct('InvokeAgentTeam', fns.invokeAgent, { 'runId.$': '$.runId', 'request.$': '$.request' }, '$.agent');
  invokeAgent.addCatch(markFailed, catchAll);

  const persist = direct('PersistProposal', fns.persistProposal, { 'runId.$': '$.runId', 'agent.$': '$.agent' }, '$.persist');
  persist.addCatch(markFailed, catchAll);

  const policy = direct('PolicyCheck', fns.policyCheck, { 'runId.$': '$.runId', 'requesterId.$': '$.requesterId' }, '$.policy');
  policy.addCatch(markFailed, catchAll);

  const requestApproval = new tasks.LambdaInvoke(scope, 'RequestApproval', {
    lambdaFunction: fns.requestApproval,
    integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    payload: sfn.TaskInput.fromObject({
      taskToken: sfn.JsonPath.taskToken,
      'runId.$': '$.runId',
      'requesterId.$': '$.requesterId',
      'proposalHash.$': '$.persist.proposalHash',
      'policy.$': '$.policy',
    }),
    taskTimeout: sfn.Timeout.duration(Duration.seconds(opts.approvalTimeoutSeconds)),
    resultPath: '$.approval',
  });
  requestApproval.addCatch(markExpired, { errors: ['States.Timeout'], resultPath: '$.error' });
  requestApproval.addCatch(markRejectedByHuman, { errors: ['HumanRejected'], resultPath: '$.error' });
  requestApproval.addCatch(markFailed, catchAll);

  const executePo = new tasks.LambdaInvoke(scope, 'ExecutePO', {
    lambdaFunction: fns.executePo,
    payload: sfn.TaskInput.fromObject({ 'runId.$': '$.runId', 'requesterId.$': '$.requesterId' }),
    payloadResponseOnly: true,
    resultPath: '$.execution',
  });
  // Business errors are final; everything else (including a crash after commit) is retried safely because execute-po is idempotent.
  executePo.addRetry({ errors: ['BudgetExhausted', 'HashMismatch', 'NotApproved'], maxAttempts: 0 });
  executePo.addRetry({ errors: ['States.ALL'], maxAttempts: 3, interval: Duration.seconds(1), backoffRate: 2 });
  executePo.addCatch(markFailed, catchAll);

  const passed = new sfn.Choice(scope, 'PolicyPassed?')
    .when(sfn.Condition.booleanEquals('$.policy.ok', true), requestApproval.next(executePo).next(markDone))
    .otherwise(markRejectedByPolicy);

  return invokeAgent.next(persist).next(policy).next(passed);
}
