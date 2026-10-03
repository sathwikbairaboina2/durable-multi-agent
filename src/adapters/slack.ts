import type { SlackMessage } from '../core/slack-message.js';

export interface SlackPort {
  postMessage(m: { channel: string } & SlackMessage): Promise<{ ts: string; channel: string }>;
  updateMessage(m: { channel: string; ts: string } & SlackMessage): Promise<void>;
}

export class SlackWebClient implements SlackPort {
  constructor(
    private readonly apiBase: string = 'https://slack.com/api',
    private readonly botToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(method: string, body: object): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(`${this.apiBase}/${method}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.botToken}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (json.ok !== true) throw new Error(`slack ${method}: ${String(json.error ?? res.status)}`);
    return json;
  }

  async postMessage(m: { channel: string } & SlackMessage): Promise<{ ts: string; channel: string }> {
    const j = await this.call('chat.postMessage', m);
    return { ts: String(j.ts), channel: String(j.channel ?? m.channel) };
  }

  async updateMessage(m: { channel: string; ts: string } & SlackMessage): Promise<void> {
    await this.call('chat.update', m);
  }
}
