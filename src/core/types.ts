export type RunStatus =
  | 'PLANNING' | 'POLICY' | 'AWAITING_APPROVAL' | 'EXECUTING' | 'DONE'
  | 'REJECTED_BY_POLICY' | 'REJECTED_BY_HUMAN' | 'EXPIRED' | 'FAILED';
export type ApprovalState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
export type Decision = 'approve' | 'reject';

export interface CatalogItem {
  sku: string; name: string; vendor: string;
  unitPriceCents: number; maxQtyPerOrder: number; active: boolean;
}
export interface ProposalLine { sku: string; qty: number; claimedUnitPriceCents?: number }
export interface ProposedOrder { runId: string; currency: 'USD'; lines: ProposalLine[]; justification: string }
export interface PricedLine { sku: string; name: string; qty: number; unitPriceCents: number; lineCents: number }
export interface Budget { requesterId: string; month: string; limitCents: number; spentCents: number }
export interface PolicyResult {
  ok: boolean; totalCents: number; pricedLines: PricedLine[];
  reasons: string[]; remainingBudgetCents: number | null;
}
export interface ApprovalRecord {
  runId: string; approvalId: string; proposalHash: string; totalCents: number;
  pricedLines: PricedLine[]; state: ApprovalState; decidedBy?: string; decidedAt?: string;
}
export interface LedgerEntry {
  runId: string; requesterId: string; lines: PricedLine[]; totalCents: number;
  approvedBy: string; proposalHash: string; createdAt: string;
}
export interface ModelUsage { inputTokens: number; outputTokens: number; modelSteps: number }
