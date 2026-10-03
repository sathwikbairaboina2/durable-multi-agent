import { Validations, type Stack } from 'aws-cdk-lib';

/**
 * Acknowledged cdk-nag findings. Every entry carries a reason and IAM findings are listed one by one,
 * so a new wildcard fails the build instead of passing under a blanket suppression.
 * The Flow function ids below are CDK-generated logical ids; they change only if a construct id changes.
 */
const KMS = 'Granted by the table key grant helper for the customer-managed Runs key (scoped to that key); required to read and write encrypted items.';
const INVOKE = 'Step Functions needs lambda:InvokeFunction on the function and its versions/aliases (`:*`); the grant is limited to this one function.';

export const NAG_ACKNOWLEDGEMENTS: ReadonlyArray<{ id: string; reason: string }> = [
  {
    id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]',
    reason: 'AWSLambdaBasicExecutionRole is the AWS-managed policy for CloudWatch Logs writes; each log group is created in this stack.',
  },
  { id: 'AwsSolutions-IAM5[Action::kms:GenerateDataKey*]', reason: KMS },
  { id: 'AwsSolutions-IAM5[Action::kms:ReEncrypt*]', reason: KMS },
  {
    id: 'AwsSolutions-IAM5[Resource::*]',
    reason: 'X-Ray PutTraceSegments/PutTelemetryRecords and the state machine log delivery actions do not support resource-level permissions.',
  },
  {
    id: 'AwsSolutions-IAM5[Resource::<AgentRuntimeArn>/*]',
    reason: 'AgentCore requires invoke permission on the runtime ARN and its endpoint sub-resources (`/*`); the runtime ARN is a stack parameter.',
  },
  { id: 'AwsSolutions-IAM5[Resource::<FlowExecutePoFn8BD347BE.Arn>:*]', reason: INVOKE },
  { id: 'AwsSolutions-IAM5[Resource::<FlowFinalizeFnAA6EF283.Arn>:*]', reason: INVOKE },
  { id: 'AwsSolutions-IAM5[Resource::<FlowInvokeAgentFn320A06B8.Arn>:*]', reason: INVOKE },
  { id: 'AwsSolutions-IAM5[Resource::<FlowPersistProposalFn31B0973E.Arn>:*]', reason: INVOKE },
  { id: 'AwsSolutions-IAM5[Resource::<FlowPolicyCheckFnD7AC1038.Arn>:*]', reason: INVOKE },
  { id: 'AwsSolutions-IAM5[Resource::<FlowRequestApprovalFn7878F3E1.Arn>:*]', reason: INVOKE },
  {
    id: 'AwsSolutions-APIG4',
    reason: 'The Slack route cannot use IAM; slack-interactions verifies the Slack HMAC signature and timestamp before any state change.',
  },
  {
    id: 'AwsSolutions-SMG4',
    reason: 'The secret holds Slack credentials, which are rotated in Slack, not by a Lambda rotation function.',
  },
];

export function applyNagSuppressions(stack: Stack, extra: ReadonlyArray<{ id: string; reason: string }> = []): void {
  for (const a of [...NAG_ACKNOWLEDGEMENTS, ...extra]) Validations.of(stack).acknowledge(a);
}
