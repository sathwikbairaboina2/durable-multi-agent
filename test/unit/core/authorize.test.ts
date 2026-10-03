import { describe, expect, it } from 'vitest';
import { authorizeApprover, parseApproverIds } from '../../../src/core/authorize.js';

describe('authorizeApprover', () => {
  const rows: Array<[string, string, string[], unknown]> = [
    ['U0APPROVER1', 'U0REQ1', ['U0APPROVER1'], { ok: true }],
    ['U0REQ1', 'U0REQ1', ['U0REQ1'], { ok: false, reason: 'SELF_APPROVAL' }],
    ['U0OTHER', 'U0REQ1', ['U0APPROVER1'], { ok: false, reason: 'NOT_AN_APPROVER' }],
    ['U0APPROVER1', 'U0REQ1', [], { ok: false, reason: 'NOT_AN_APPROVER' }],
  ];
  it.each(rows)('%s for requester %s in %j', (approverId, requesterId, approverIds, expected) => {
    expect(authorizeApprover({ approverId, requesterId, approverIds })).toEqual(expected);
  });
  it('parses a CSV of approver ids', () => {
    expect(parseApproverIds(' U0A1, ,U0A2 ')).toEqual(['U0A1', 'U0A2']);
    expect(parseApproverIds(undefined)).toEqual([]);
  });
});
