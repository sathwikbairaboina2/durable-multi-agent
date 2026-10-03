import { proposalHash } from './hash.js';
import type { ApprovalRecord, Budget, LedgerEntry } from './types.js';

export interface ExecutionInput {
  runId: string;
  requesterId: string;
  storedProposal: unknown;
  approval: Pick<ApprovalRecord, 'state' | 'proposalHash' | 'decidedBy' | 'totalCents' | 'pricedLines'> | null;
  budget: Pick<Budget, 'limitCents' | 'spentCents'> | null;
  nowIso: string;
}

export type ExecutionPlan =
  | {
      ok: true; proposalHash: string; totalCents: number; limitCents: number;
      maxSpentBeforeCents: number; ledgerEntry: LedgerEntry;
    }
  | { ok: false; error: 'NotApproved' | 'HashMismatch' | 'BudgetExhausted'; message: string };

export function planExecution(input: ExecutionInput): ExecutionPlan {
  const { approval, budget } = input;
  if (!approval || approval.state !== 'APPROVED') {
    return { ok: false, error: 'NotApproved', message: `approval is ${approval ? approval.state : 'missing'}` };
  }
  const actualHash = proposalHash(input.storedProposal);
  if (actualHash !== approval.proposalHash) {
    return { ok: false, error: 'HashMismatch', message: 'approved hash differs from the stored proposal' };
  }
  if (!budget) {
    return { ok: false, error: 'BudgetExhausted', message: 'no budget for this month' };
  }
  const maxSpentBeforeCents = budget.limitCents - approval.totalCents;
  if (maxSpentBeforeCents < 0 || maxSpentBeforeCents < budget.spentCents) {
    return { ok: false, error: 'BudgetExhausted', message: 'order exceeds the remaining budget' };
  }
  return {
    ok: true,
    proposalHash: actualHash,
    totalCents: approval.totalCents,
    limitCents: budget.limitCents,
    maxSpentBeforeCents,
    ledgerEntry: {
      runId: input.runId,
      requesterId: input.requesterId,
      lines: approval.pricedLines,
      totalCents: approval.totalCents,
      approvedBy: approval.decidedBy ?? '',
      proposalHash: actualHash,
      createdAt: input.nowIso,
    },
  };
}
