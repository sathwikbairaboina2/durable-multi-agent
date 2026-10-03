import { describe, expect, it } from 'vitest';
import { runChaosBench } from '../../bench/chaos.js';

describe.skipIf(process.env.DMA_INTEGRATION !== '1')('chaos benchmark', () => {
  it('keeps the ledger, statuses and budgets consistent under crashes, double clicks and a budget race', async () => {
    process.env.DMA_QUIET_LOGS = '1';
    const r = await runChaosBench({ runs: 20, write: false, concurrency: 10, crashRate: 0.5 });
    expect(r.ledgerStatusMismatches).toBe(0);
    expect(r.budgetDriftCents).toBe(0);
    expect(r.overspendCents).toBe(0);
    expect(r.crashesInjected).toBeGreaterThan(0);
    expect(r.counts.DONE).toBeGreaterThan(0);
  });
});
