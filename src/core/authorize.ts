export type AuthResult = { ok: true } | { ok: false; reason: 'SELF_APPROVAL' | 'NOT_AN_APPROVER' };

export function authorizeApprover(i: { approverId: string; requesterId: string; approverIds: readonly string[] }): AuthResult {
  if (i.approverId === i.requesterId) return { ok: false, reason: 'SELF_APPROVAL' };
  if (!i.approverIds.includes(i.approverId)) return { ok: false, reason: 'NOT_AN_APPROVER' };
  return { ok: true };
}

export function parseApproverIds(csv?: string): string[] {
  return (csv ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}
