import { App, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { applyNagSuppressions } from '../lib/nag.js';
import { DurableMultiAgentStack } from '../lib/stack.js';

const app = new App();
const stack = new DurableMultiAgentStack(app, 'DurableMultiAgentStack', {
  stage: 'aws',
  approverIds: app.node.tryGetContext('approverIds') ?? '',
  slackChannelId: app.node.tryGetContext('slackChannelId'),
});
Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
applyNagSuppressions(stack);
