import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface HeadlineInput {
  config: { runs: number };
  crashesInjected: number;
  doubleClicks: number;
  conflictingClicks: number;
  ledgerStatusMismatches: number;
  budgetDriftCents: number;
  overspendCents: number;
  measuredAt: string;
}

const dollars = (cents: number): string => (cents / 100).toFixed(2);

/** The README headline. Generated from measured results; nobody types it by hand. */
export function formatHeadline(r: HeadlineInput): string {
  return (
    `${r.config.runs} approval runs with ${r.crashesInjected} crashes injected after commit, ` +
    `${r.doubleClicks + r.conflictingClicks} double clicks and a budget race: ` +
    `${r.ledgerStatusMismatches} duplicate or missing purchase orders, ` +
    `$${dollars(r.budgetDriftCents)} budget drift, $${dollars(r.overspendCents)} overspend ` +
    `(Step Functions Local + DynamoDB Local, ${r.measuredAt.slice(0, 10)}).`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = new URL('./results/latest.json', import.meta.url);
  console.log(formatHeadline(JSON.parse(readFileSync(file, 'utf8'))));
}
