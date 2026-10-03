# ADR 0003: The deterministic core owns money and status

Status: accepted, 2026-10-04

## Context

The agents propose; something must dispose. A model must never be able to decide a price, skip the budget, or write to the ledger.

## Decision

- `src/core/` holds pure TypeScript modules with no AWS SDK imports: `hash`, `schema`, `policy`, `status`, `authorize`, `slack-verify`, `slack-message`, `execute`. Handlers are thin adapters.
- Money is integer cents. Totals are recomputed from catalog prices. The agent's `claimedUnitPriceCents` is kept only for evals (I2).
- The approval is bound to `sha256(canonicalJson(proposal))`. `execute-po` recomputes the hash of the stored proposal. The transaction then condition-checks the approval item for `state = APPROVED AND proposalHash = :h` (I1).
- One `TransactWriteItems` call does four things together:
  - the approval check;
  - the ledger put (`attribute_not_exists(pk)`);
  - the budget increment;
  - the `EXECUTING → DONE` status change.

  Budget arithmetic is done in code, because DynamoDB conditions cannot add: `limitCents = :lim AND spentCents <= :maxSpentBefore` (I3).
- A retry after commit is detected by reading back the ledger row. If its `proposalHash` matches, the handler returns success without charging again (I4).
- Every status change is a conditional update on the expected prior status, checked against a transition table in `core/status.ts`.

## What we gave up

- An extra read (budget `limitCents`) before each execution transaction, and a second read on the retry path.
- The approver approves the priced lines computed at policy time. If catalog prices change between approval and execution, the ledger uses the approved prices, not the new ones. This is deliberate (the human approved a number) and documented.
