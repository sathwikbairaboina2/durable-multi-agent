import { parseArgs } from 'node:util';
import { monthOf } from '../src/adapters/budgets-repo.js';
import { formatCents } from '../src/core/money.js';
import type { RunStatus } from '../src/core/types.js';
import { LocalDriver } from '../src/local/driver.js';
import { startLocalEnv } from '../src/local/env.js';
import { seedAll } from '../src/local/seed.js';
import { renderCard } from './render.js';

const AGENT_URL = 'http://127.0.0.1:5333';
const REQUESTER = 'U0REQUESTER';
const TERMINAL: RunStatus[] = ['DONE', 'REJECTED_BY_POLICY', 'REJECTED_BY_HUMAN', 'EXPIRED', 'FAILED'];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function demo(argv: string[]): Promise<number> {
  process.env.DMA_QUIET_LOGS = '1';
  const { values } = parseArgs({
    args: argv,
    options: {
      request: { type: 'string', default: 'We need 3 more GPU dev boxes for the ML team, under $9k' },
      decision: { type: 'string', default: 'approve' },
      approver: { type: 'string', default: 'U0APPROVER1' },
    },
  });
  const decision = values.decision === 'reject' ? 'reject' : 'approve';

  try {
    const ping = await fetch(`${AGENT_URL}/ping`, { signal: AbortSignal.timeout(3000) });
    if (!ping.ok) throw new Error(`HTTP ${ping.status}`);
  } catch {
    console.error(`Agent container not reachable at ${AGENT_URL}. Start it: docker compose up -d --build agent`);
    return 2;
  }

  const t0 = Date.now();
  const env = await startLocalEnv();
  try {
    await seedAll(env);
    const driver = new LocalDriver(env);

    console.log(`▶ request from <@${REQUESTER}>: "${values.request}"`);
    const runId = await driver.startRun(REQUESTER, values.request!);
    const started = Date.now();

    let last = '';
    let clicked = false;
    let reply = '';
    for (;;) {
      const meta = await env.runs.getMeta(runId);
      if (meta && meta.status !== last) {
        last = meta.status;
        console.log(`  +${String(Date.now() - started).padStart(5)}ms  ${meta.status}`);
        if (meta.status === 'AWAITING_APPROVAL' && !clicked) {
          const approvalId = await driver.waitForApproval(runId);
          const post = env.slack.posts().find((p) => JSON.stringify(p.body).includes(runId))!;
          console.log(`\n${renderCard(post.body)}\n`);
          clicked = true;
          const r = await driver.click(runId, values.approver!, decision, { approvalId });
          console.log(`✔ <@${values.approver}> clicked ${decision === 'approve' ? 'Approve' : 'Reject'} → "${r.text}"`);
          reply = r.text;
        }
      }
      if (meta && TERMINAL.includes(meta.status)) break;
      if (Date.now() - started > 600_000) throw new Error(`Timed out in status ${last}`);
      await sleep(200);
    }

    const final = (await env.runs.getMeta(runId))!;
    const ledger = await env.ledger.get(runId);
    const stored = await env.runs.getProposal(runId);
    const budget = await env.budgets.get(REQUESTER, monthOf(new Date().toISOString()));
    console.log(`\nOutcome: ${final.status}${final.failureReason ? ` (${final.failureReason})` : ''}`);
    if (ledger) console.log(`  PO#${runId} ${formatCents(ledger.totalCents)} approved by ${ledger.approvedBy}`);
    if (budget) console.log(`  budget left this month: ${formatCents(budget.limitCents - budget.spentCents)}`);
    if (stored) {
      console.log(`  agent model: ${stored.model ?? 'unknown'}, ${stored.usage.modelSteps} model steps, ${stored.usage.inputTokens} input / ${stored.usage.outputTokens} output tokens`);
    }
    console.log(`  total elapsed: ${((Date.now() - t0) / 1000).toFixed(1)} s (approval reply: "${reply}")`);
    const expected = decision === 'approve' ? 'DONE' : 'REJECTED_BY_HUMAN';
    return final.status === expected ? 0 : 1;
  } finally {
    await env.close();
  }
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'demo') return demo(rest);
  if (command === 'bench') {
    const { benchCommand } = await import('../bench/chaos.js');
    return benchCommand(rest);
  }
  console.error('usage: pa demo [--request <text>] [--decision approve|reject] [--approver <id>] | pa bench [--runs N ...]');
  return 2;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
