import { afterEach, describe, expect, it } from 'vitest';
import { SlackWebClient } from '../../../src/adapters/slack.js';
import { buildApprovalMessage } from '../../../src/core/slack-message.js';
import { startSlackSink, type SlackSink } from '../../../src/local/slack-sink.js';
import { RUN_ID } from '../fixtures.js';

let sink: SlackSink | undefined;
afterEach(async () => { await sink?.close(); sink = undefined; });

describe('slack sink', () => {
  it('records posts and updates and finds the approval id', async () => {
    sink = await startSlackSink({ port: 5338 });
    const client = new SlackWebClient(`${sink.url}/api`, 'xoxb-test');
    const approvalId = '01J9ZX5K3M8Q4R6T7V9W1Y2Z3B';
    const msg = buildApprovalMessage({
      runId: RUN_ID, approvalId, requesterId: 'U0REQ1', pricedLines: [], totalCents: 100, remainingBudgetCents: 0, justification: 'j',
    });
    const posted = await client.postMessage({ channel: 'C1', ...msg });
    await client.updateMessage({ channel: 'C1', ts: posted.ts, text: 'done', blocks: [] });
    expect(sink.posts()).toHaveLength(1);
    expect(sink.updates()).toHaveLength(1);
    expect(sink.approvalFor(RUN_ID)).toEqual({ approvalId });
    expect(sink.approvalFor('01J9ZX5K3M8Q4R6T7V9W1Y2ZZZ')).toBeNull();
    expect(posted.ts).toMatch(/^\d+\.\d{6}$/);
  });
});
