import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadSlackSecrets, resetSecretsCache } from '../../../src/adapters/secrets.js';
import { SlackWebClient } from '../../../src/adapters/slack.js';

describe('SlackWebClient', () => {
  it('posts with a bearer token and returns ts and channel', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ ok: true, ts: '1.2', channel: 'C1' }));
    }) as unknown as typeof fetch;
    const c = new SlackWebClient('http://sink', 'xoxb-test', f);
    expect(await c.postMessage({ channel: 'C1', text: 'hi', blocks: [] })).toEqual({ ts: '1.2', channel: 'C1' });
    expect(seen!.url).toBe('http://sink/chat.postMessage');
    expect((seen!.init.headers as Record<string, string>).authorization).toBe('Bearer xoxb-test');
  });
  it('updates via chat.update', async () => {
    let url = '';
    const f = (async (u: string) => { url = u; return new Response('{"ok":true}'); }) as unknown as typeof fetch;
    await new SlackWebClient('http://sink', 't', f).updateMessage({ channel: 'C1', ts: '1.2', text: 'x', blocks: [] });
    expect(url).toBe('http://sink/chat.update');
  });
  it('throws when Slack says ok:false', async () => {
    const f = (async () => new Response('{"ok":false,"error":"channel_not_found"}')) as unknown as typeof fetch;
    await expect(new SlackWebClient('http://sink', 't', f).postMessage({ channel: 'C1', text: 'x', blocks: [] }))
      .rejects.toThrow('slack chat.postMessage: channel_not_found');
  });
  it('defaults the API base to slack.com', async () => {
    let url = '';
    const f = (async (u: string) => { url = u; return new Response('{"ok":true,"ts":"1"}'); }) as unknown as typeof fetch;
    await new SlackWebClient(undefined, 't', f).postMessage({ channel: 'C1', text: 'x', blocks: [] });
    expect(url).toBe('https://slack.com/api/chat.postMessage');
  });
});

describe('loadSlackSecrets', () => {
  const sm = mockClient(SecretsManagerClient);
  beforeEach(() => { sm.reset(); resetSecretsCache(); });

  it('uses env values without calling Secrets Manager', async () => {
    const s = await loadSlackSecrets({ SLACK_SIGNING_SECRET: 'sig', SLACK_BOT_TOKEN: 'bot' });
    expect(s).toEqual({ signingSecret: 'sig', botToken: 'bot' });
    expect(sm.commandCalls(GetSecretValueCommand)).toHaveLength(0);
  });
  it('falls back to Secrets Manager and caches', async () => {
    sm.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify({ signingSecret: 's2', botToken: 'b2' }) });
    const env = { SLACK_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:x' };
    const client = new SecretsManagerClient({ region: 'us-east-1' });
    expect(await loadSlackSecrets(env, client)).toEqual({ signingSecret: 's2', botToken: 'b2' });
    await loadSlackSecrets(env, client);
    expect(sm.commandCalls(GetSecretValueCommand)).toHaveLength(1);
  });
  it('throws when nothing is configured', async () => {
    await expect(loadSlackSecrets({})).rejects.toThrow('Missing environment variable SLACK_SECRET_ARN');
  });
});
