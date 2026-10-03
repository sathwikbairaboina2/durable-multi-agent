# ADR 0008: Chaos benchmark as the headline number

Status: accepted, 2026-10-04

## Decision

`npm run bench -- --runs <N>` (default 200) sends N requests through the synthesized state machine on SFN Local and DynamoDB Local. It injects three kinds of trouble:

- **Crash after commit.** In the benchmark's Lambda host only (never in shipped code), `execute-po` is wrapped. After the real handler returns, the wrapper throws `ChaosError` with probability `--crash-rate` (default 0.3), and the state machine retries.
- **Double clicks.** Every approval is sent as two concurrent signed Slack interactions. A share of runs set by `--conflict-rate` (default 0.1) get an approve and a reject at the same time.
- **Budget race.** Each requester's monthly budget fits only a share of the orders set by `--budget-fits` (default 0.7). Approvals are sent with `--concurrency` (default 20) in flight.

A seeded PRNG (`--seed`, default 42) makes a run reproducible.

The benchmark writes `bench/results/latest.json` and `bench/results/<YYYY-MM-DD>-<runs>.json`. They hold:

- the config;
- counts per final status;
- `crashesInjected` and `ledgerRows`;
- `ledgerStatusMismatches`: ledger rows whose run is not `DONE`, plus `DONE` runs with no row;
- `budgetDriftCents`: Σ `spentCents` − Σ ledger `totalCents`;
- `overspendCents`: Σ max(0, spent − limit);
- `approvalToLedgerMs`, as p50 and p95;
- `stateTransitionsPerRun`: the median count of `*StateEntered` events from `GetExecutionHistory`;
- `estimatedSfnCostPerRunUsd`: transitions × $0.000025. That rate is the Standard workflow price of $0.025 per 1,000 state transitions in us-east-1, and it is labelled an estimate.

`npm run bench:headline` generates the README headline sentence from `latest.json`. Nobody types it by hand.

## What we gave up

- Local latency numbers are not AWS numbers. The README labels them "local".
- Crash injection happens at the Lambda boundary, after the handler returns. It is not a process kill inside the DynamoDB call. It proves the retry path, not partial-write recovery; DynamoDB transactions are atomic by contract.
