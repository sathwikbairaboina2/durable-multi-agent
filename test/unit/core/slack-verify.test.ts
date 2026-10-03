import { describe, expect, it } from 'vitest';
import { signSlackRequest, verifySlackRequest } from '../../../src/core/slack-verify.js';

const SECRET = '8f742231b10e8888abcd99yyyzzz85a5';
const TS = '1531420618';
const BODY = 'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c';
const SIG = 'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503';

const verify = (over: Partial<Parameters<typeof verifySlackRequest>[0]> = {}) =>
  verifySlackRequest({ signingSecret: SECRET, timestamp: TS, signature: SIG, rawBody: BODY, nowSeconds: 1531420618 + 10, ...over });

describe('slack signature', () => {
  it('matches the documented example', () => {
    expect(signSlackRequest(SECRET, TS, BODY)).toBe(SIG);
  });
  it('accepts a valid signature', () => {
    expect(verify()).toEqual({ ok: true });
  });
  it('rejects stale and future timestamps', () => {
    expect(verify({ nowSeconds: 1531420618 + 301 })).toEqual({ ok: false, reason: 'STALE' });
    expect(verify({ nowSeconds: 1531420618 - 301 })).toEqual({ ok: false, reason: 'STALE' });
  });
  it('rejects a tampered body', () => {
    expect(verify({ rawBody: BODY.replace('roadrunner', 'roadrunnez') })).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });
  it('rejects a wrong-length signature without throwing', () => {
    expect(verify({ signature: 'v0=abc' })).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });
  it('rejects missing headers', () => {
    expect(verify({ timestamp: undefined })).toEqual({ ok: false, reason: 'MISSING_HEADERS' });
    expect(verify({ signature: undefined })).toEqual({ ok: false, reason: 'MISSING_HEADERS' });
  });
  it('treats a non-numeric timestamp as stale', () => {
    expect(verify({ timestamp: 'abc' })).toEqual({ ok: false, reason: 'STALE' });
  });
});
