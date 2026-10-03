# ADR 0004: Human approval with `.waitForTaskToken` and an opaque approval id

Status: accepted, 2026-10-04

## Decision

- `RequestApproval` uses `lambda:invoke.waitForTaskToken`. Its `TimeoutSeconds` comes from the CDK prop `approvalTimeoutSeconds` (default 172800, which is 48 h). The execution waits at no compute cost.
- `request-approval` does one transaction. It stores the task token on the `APPROVAL` item under a fresh ULID `approvalId`, writes an `APPROVAL#<id>` lookup item, and makes the `POLICY → AWAITING_APPROVAL` status change. Slack buttons carry only `{"a": approvalId, "d": "approve" | "reject"}` (I11).
- `slack-interactions` does these steps in order:
  1. Verify the Slack v0 HMAC, with a 300 s window and a constant-time compare (I6).
  2. Authorize the clicker: not the requester, and listed in `APPROVER_IDS` (I5).
  3. CAS-update `state` from `PENDING` (I7).
  4. Only then call `SendTaskSuccess` or `SendTaskFailure("HumanRejected")`.

  The CAS loser and late clicks get an ephemeral reply and change nothing.
- The `Runs` table is encrypted with a customer-managed KMS key, with rotation on. IAM grants are least-privilege per handler and are asserted in `infra/test/iam.test.ts`.

## What we gave up

- **Field-level encryption** of the token (the design's "taskToken encrypted with KMS"). v0.1 relies on table-level CMK encryption plus IAM. KMS is not emulated locally, so field-level encryption would be untested code. Deferred to v0.2.
- **Two-step decide-then-resume.** `SendTaskSuccess` can fail after the CAS, even after 3 SDK retries. The approval then says `APPROVED`, but the run waits until its timeout and expires without executing. That is safe, because no money moves, but it is a bad experience. A reconciler is v0.2 work.
- Rejection is terminal in v0.1 (no revise loop).
