import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { requireEnv, type Env } from '../config.js';

export interface SlackSecrets { signingSecret: string; botToken: string }

let cache: { arn: string; value: Promise<SlackSecrets> } | undefined;

export function resetSecretsCache(): void {
  cache = undefined;
}

export async function loadSlackSecrets(env: Env, client?: SecretsManagerClient): Promise<SlackSecrets> {
  if (env.SLACK_SIGNING_SECRET && env.SLACK_BOT_TOKEN) {
    return { signingSecret: env.SLACK_SIGNING_SECRET, botToken: env.SLACK_BOT_TOKEN };
  }
  const arn = requireEnv(env, 'SLACK_SECRET_ARN');
  if (cache?.arn === arn) return cache.value;
  const sm = client ?? new SecretsManagerClient({});
  const value = sm.send(new GetSecretValueCommand({ SecretId: arn })).then((r) => {
    const parsed = JSON.parse(r.SecretString ?? '{}') as Partial<SlackSecrets>;
    if (!parsed.signingSecret || !parsed.botToken) throw new Error('Slack secret must contain signingSecret and botToken');
    return { signingSecret: parsed.signingSecret, botToken: parsed.botToken };
  });
  cache = { arn, value };
  value.catch(() => { if (cache?.value === value) cache = undefined; });
  return value;
}
