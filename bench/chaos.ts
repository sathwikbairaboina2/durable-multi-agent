import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { monthOf } from '../src/adapters/budgets-repo.js';
import type { RunStatus } from '../src/core/types.js';
import { LocalDriver } from '../src/local/driver.js';
import { startLocalEnv, type Handler } from '../src/local/env.js';
import { functionAgent } from '../src/local/fixture-agent.js';
import { seedCatalog, seedCatalogItems, seedBudget } from '../src/local/seed.js';
import { median, mulberry32, percentile } from './stats.js';

const TERMINAL: RunStatus[] = ['DONE', 'REJECTED_BY_POLICY', 'REJECTED_BY_HUMAN', 'EXPIRED', 'FAILED'];
const BENCH_SKUS = ['MONITOR-27-4K', 'DOCK-USB4', 'KEYBOARD-ERGO', 'HEADSET-ANC'];
const REQUESTERS = ['U0BENCH1', 'U0BENCH2', 'U0BENCH3', 'U0BENCH4', 'U0BENCH5'];
/** Step Functions Standard: $0.025 per 1,000 state transitions in us-east-1. An estimate, not a bill. */
const USD_PER_TRANSITION = 0.000025;

export interface BenchOptions {
  runs?: number;
  crashRate?: number;
  conflictRate?: number;
  budgetFits?: number;
  concurrency?: number;
  seed?: number;
  write?: boolean;
}

export interface BenchResult {
  config: { runs: number; crashRate: number; conflictRate: number; budgetFits: number; concurrency: number; seed: number };
  counts: Record<string, number>;
  failureReasons: Record<string, number>;
  crashesInjected: number;
  doubleClicks: number;
  conflictingClicks: number;
  ledgerRows: number;
  ledgerStatusMismatches: number;
  budgetDriftCents: number;
  overspendCents: number;
  approvalToLedgerMs: { p50: number | null; p95: number | null };
  stateTransitionsPerRun: { median: number | null; min: number | null; max: number | null };
  estimatedSfnCostPerRunUsd: number | null;
  wallClockSeconds: number;
  environment: { stepFunctionsLocal: string; dynamodbLocal: string; node: string; platform: string };
  measuredAt: string;
}

async function pool<T>(items: T[], size: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

interface PlannedOrder { requester: string; lines: Array<{ sku: string; qty: number }>; totalCents: number; text: string }

export async function runChaosBench(opts: BenchOptions = {}): Promise<BenchResult> {
  const cfg = {
    runs: opts.runs ?? 200,
    crashRate: opts.crashRate ?? 0.3,
    conflictRate: opts.conflictRate ?? 0.1,
    budgetFits: opts.budgetFits ?? 0.7,
    concurrency: opts.concurrency ?? 20,
    seed: opts.seed ?? 42,
  };
  const write = opts.write ?? true;
  const started = Date.now();

  // Orders come from their own PRNG stream so crash decisions never shift them.
  const orderRand = mulberry32(cfg.seed);
  const crashRand = mulberry32(cfg.seed + 1);
  const clickRand = mulberry32(cfg.seed + 2);
  const price = new Map(seedCatalogItems().map((i) => [i.sku, i.unitPriceCents]));

  const orders: PlannedOrder[] = [];
  for (let i = 0; i < cfg.runs; i++) {
    const nLines = 1 + Math.floor(orderRand() * 2);
    const pool2 = [...BENCH_SKUS];
    const lines: PlannedOrder['lines'] = [];
    for (let l = 0; l < nLines; l++) {
      const sku = pool2.splice(Math.floor(orderRand() * pool2.length), 1)[0]!;
      lines.push({ sku, qty: 1 + Math.floor(orderRand() * 3) });
    }
    const totalCents = lines.reduce((s, l) => s + price.get(l.sku)! * l.qty, 0);
    orders.push({
      requester: REQUESTERS[i % REQUESTERS.length]!,
      lines,
      totalCents,
      text: `bench run #${i}: ${lines.map((l) => `${l.qty} x ${l.sku}`).join(', ')}`,
    });
  }
  const limits = new Map<string, number>();
  for (const r of REQUESTERS) {
    const sum = orders.filter((o) => o.requester === r).reduce((s, o) => s + o.totalCents, 0);
    limits.set(r, Math.floor(cfg.budgetFits * sum));
  }

  let crashesInjected = 0;
  const env = await startLocalEnv({
    agentClient: functionAgent((inv) => {
      const n = Number(/^bench run #(\d+):/.exec(inv.request)?.[1]);
      const o = orders[n];
      if (!o) throw new Error(`unknown bench request: ${inv.request}`);
      return {
        proposal: { runId: inv.runId, currency: 'USD', lines: o.lines, justification: `Benchmark order ${n}.` },
        usage: { inputTokens: 0, outputTokens: 0, modelSteps: 0 },
        model: 'fixture',
      };
    }),
    wrapHandler: (name, h): Handler => {
      if (name !== 'execute-po') return h;
      return async (event) => {
        const result = await h(event);
        if (crashRand() < cfg.crashRate) {
          crashesInjected += 1;
          throw Object.assign(new Error('chaos: crash after commit'), { name: 'ChaosError' });
        }
        return result;
      };
    },
  });

  try {
    await seedCatalog(env.catalog);
    for (const r of REQUESTERS) await seedBudget(env.budgets, r, limits.get(r)!);
    const driver = new LocalDriver(env);
    const month = monthOf(new Date().toISOString());

    // Phase 1: start every run, then wait for it to reach the approval gate.
    const runIds: string[] = new Array(cfg.runs);
    await pool(orders, cfg.concurrency, async (o, i) => {
      runIds[i] = await driver.startRun(o.requester, o.text);
    });
    const waiting: number[] = [];
    await pool(runIds, cfg.concurrency, async (id, i) => {
      const meta = await driver.waitForStatus(id, ['AWAITING_APPROVAL', ...TERMINAL], 300_000);
      if (meta.status === 'AWAITING_APPROVAL') waiting.push(i);
    });

    // Phase 2: two concurrent clicks on every approval.
    let doubleClicks = 0;
    let conflictingClicks = 0;
    const t0 = new Map<number, number>();
    await pool(waiting, cfg.concurrency, async (i) => {
      const id = runIds[i]!;
      const conflict = clickRand() < cfg.conflictRate;
      if (conflict) conflictingClicks += 1; else doubleClicks += 1;
      t0.set(i, Date.now());
      await Promise.all([
        driver.click(id, 'U0APPROVER1', 'approve'),
        driver.click(id, 'U0APPROVER2', conflict ? 'reject' : 'approve'),
      ]);
    });

    // Phase 3: wait for every run to finish.
    const finals = new Map<string, RunStatus>();
    const failureReasons: Record<string, number> = {};
    await pool(runIds, cfg.concurrency, async (id) => {
      const meta = await driver.waitForStatus(id, TERMINAL, 15 * 60_000);
      finals.set(id, meta.status);
      if (meta.failureReason) failureReasons[meta.failureReason] = (failureReasons[meta.failureReason] ?? 0) + 1;
    });

    // Measure.
    const counts: Record<string, number> = {};
    for (const s of finals.values()) counts[s] = (counts[s] ?? 0) + 1;
    const rows = await env.ledger.scanAll();
    const rowByRun = new Map(rows.map((r) => [r.runId, r]));
    let mismatches = 0;
    for (const id of runIds) {
      const done = finals.get(id) === 'DONE';
      if (done !== rowByRun.has(id)) mismatches += 1;
    }
    for (const r of rows) if (!runIds.includes(r.runId)) mismatches += 1;

    let spentTotal = 0;
    let overspend = 0;
    for (const r of REQUESTERS) {
      const b = (await env.budgets.get(r, month))!;
      spentTotal += b.spentCents;
      overspend += Math.max(0, b.spentCents - b.limitCents);
    }
    const ledgerTotal = rows.reduce((s, r) => s + r.totalCents, 0);

    const latencies: number[] = [];
    runIds.forEach((id, i) => {
      const row = rowByRun.get(id);
      const start = t0.get(i);
      if (row && start !== undefined && finals.get(id) === 'DONE') latencies.push(Date.parse(row.createdAt) - start);
    });
    latencies.sort((a, b) => a - b);

    const transitions: number[] = [];
    await pool(runIds, cfg.concurrency, async (id) => {
      const events = await driver.history(id);
      transitions.push(events.filter((e) => String(e.type).endsWith('StateEntered')).length);
    });
    const medianTransitions = median(transitions);

    const result: BenchResult = {
      config: cfg,
      counts,
      failureReasons,
      crashesInjected,
      doubleClicks,
      conflictingClicks,
      ledgerRows: rows.length,
      ledgerStatusMismatches: mismatches,
      budgetDriftCents: spentTotal - ledgerTotal,
      overspendCents: overspend,
      approvalToLedgerMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
      stateTransitionsPerRun: {
        median: medianTransitions,
        min: transitions.length ? Math.min(...transitions) : null,
        max: transitions.length ? Math.max(...transitions) : null,
      },
      estimatedSfnCostPerRunUsd: medianTransitions === null ? null : Number((medianTransitions * USD_PER_TRANSITION).toFixed(6)),
      wallClockSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      environment: { stepFunctionsLocal: '2.0.0', dynamodbLocal: '3.3.1', node: process.version, platform: process.platform },
      measuredAt: new Date().toISOString(),
    };

    if (write) {
      const dir = new URL('./results/', import.meta.url);
      mkdirSync(dir, { recursive: true });
      const json = `${JSON.stringify(result, null, 2)}\n`;
      writeFileSync(new URL('latest.json', dir), json);
      writeFileSync(new URL(`${result.measuredAt.slice(0, 10)}-${cfg.runs}.json`, dir), json);
    }
    return result;
  } finally {
    await env.close();
  }
}

export function renderTable(r: BenchResult): string {
  const rows: Array<[string, string]> = [
    ['runs', String(r.config.runs)],
    ['final statuses', JSON.stringify(r.counts)],
    ['failure reasons', JSON.stringify(r.failureReasons)],
    ['crashes injected after commit', String(r.crashesInjected)],
    ['double clicks / conflicting clicks', `${r.doubleClicks} / ${r.conflictingClicks}`],
    ['ledger rows', String(r.ledgerRows)],
    ['ledger/status mismatches', String(r.ledgerStatusMismatches)],
    ['budget drift (cents)', String(r.budgetDriftCents)],
    ['overspend (cents)', String(r.overspendCents)],
    ['approval to ledger p50 / p95 (ms, local)', `${r.approvalToLedgerMs.p50} / ${r.approvalToLedgerMs.p95}`],
    ['state transitions per run (median, min, max)', `${r.stateTransitionsPerRun.median}, ${r.stateTransitionsPerRun.min}, ${r.stateTransitionsPerRun.max}`],
    ['estimated Step Functions cost per run (USD, estimate)', String(r.estimatedSfnCostPerRunUsd)],
    ['wall clock (s)', String(r.wallClockSeconds)],
  ];
  return ['| metric | value |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join('\n');
}

export async function benchCommand(argv: string[]): Promise<number> {
  process.env.DMA_QUIET_LOGS = '1';
  const { values } = parseArgs({
    args: argv,
    options: {
      runs: { type: 'string' },
      'crash-rate': { type: 'string' },
      'conflict-rate': { type: 'string' },
      'budget-fits': { type: 'string' },
      concurrency: { type: 'string' },
      seed: { type: 'string' },
      'no-write': { type: 'boolean', default: false },
    },
  });
  const num = (v: string | undefined): number | undefined => (v === undefined ? undefined : Number(v));
  const r = await runChaosBench({
    runs: num(values.runs),
    crashRate: num(values['crash-rate']),
    conflictRate: num(values['conflict-rate']),
    budgetFits: num(values['budget-fits']),
    concurrency: num(values.concurrency),
    seed: num(values.seed),
    write: !values['no-write'],
  });
  console.log(renderTable(r));
  const bad = r.ledgerStatusMismatches !== 0 || r.budgetDriftCents !== 0 || r.overspendCents !== 0;
  if (bad) console.error('Invariant violated: see the table above.');
  return bad ? 1 : 0;
}
