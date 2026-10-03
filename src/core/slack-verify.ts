import { createHmac, timingSafeEqual } from 'node:crypto';

export const SLACK_TOLERANCE_SECONDS = 300;

export function signSlackRequest(signingSecret: string, timestamp: string, rawBody: string): string {
  return `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`, 'utf8').digest('hex')}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'MISSING_HEADERS' | 'STALE' | 'BAD_SIGNATURE' };

export function verifySlackRequest(i: {
  signingSecret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: string;
  nowSeconds: number;
}): VerifyResult {
  if (!i.timestamp || !i.signature) return { ok: false, reason: 'MISSING_HEADERS' };
  if (!/^\d+$/.test(i.timestamp)) return { ok: false, reason: 'STALE' };
  if (Math.abs(i.nowSeconds - Number(i.timestamp)) > SLACK_TOLERANCE_SECONDS) return { ok: false, reason: 'STALE' };
  const expected = Buffer.from(signSlackRequest(i.signingSecret, i.timestamp, i.rawBody), 'utf8');
  const given = Buffer.from(i.signature, 'utf8');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'BAD_SIGNATURE' };
  return { ok: true };
}
