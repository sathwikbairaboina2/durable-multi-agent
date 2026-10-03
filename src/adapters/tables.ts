export const runKey = (runId: string, sk: string) => ({ pk: `RUN#${runId}`, sk });
export const metaKey = (runId: string) => runKey(runId, 'META');
export const proposalKey = (runId: string) => runKey(runId, 'PROPOSAL#v1');
export const approvalKey = (runId: string) => runKey(runId, 'APPROVAL');
export const lookupKey = (approvalId: string) => ({ pk: `APPROVAL#${approvalId}`, sk: 'LOOKUP' });
export const catalogKey = (sku: string) => ({ pk: `SKU#${sku}`, sk: 'ITEM' });
export const budgetKey = (requesterId: string, month: string) => ({ pk: `REQ#${requesterId}`, sk: `MONTH#${month}` });
export const ledgerKey = (runId: string) => ({ pk: `PO#${runId}`, sk: 'PO' });

export function stripKeys<T extends Record<string, unknown>>(item: T): Omit<T, 'pk' | 'sk'> {
  const { pk: _pk, sk: _sk, ...rest } = item;
  return rest;
}
