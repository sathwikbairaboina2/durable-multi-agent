import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalJson, proposalHash } from '../../../src/core/hash.js';

function shuffleKeys(v: unknown, order: number[]): unknown {
  if (Array.isArray(v)) return v.map((x) => shuffleKeys(x, order));
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shuffleKeys(x, order)] as const);
    const idx = entries.map((_, i) => i).sort((a, b) => (order[a % order.length]! - order[b % order.length]!) || a - b);
    return Object.fromEntries(idx.map((i) => entries[i]!));
  }
  return v;
}

describe('canonicalJson', () => {
  it('sorts keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe('{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}');
  });
  it('hash ignores key order (property)', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 8 }), (x, order) => {
        expect(proposalHash(shuffleKeys(x, order))).toBe(proposalHash(x));
      }),
      { numRuns: 200 },
    );
  });
  it('array order matters', () => {
    expect(proposalHash([1, 2])).not.toBe(proposalHash([2, 1]));
  });
  it('throws on unsupported values', () => {
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
    expect(() => canonicalJson(() => 1)).toThrow(TypeError);
    expect(() => canonicalJson(NaN)).toThrow(TypeError);
    expect(() => canonicalJson(Infinity)).toThrow(TypeError);
    expect(() => canonicalJson(BigInt(10))).toThrow(TypeError);
    expect(() => canonicalJson([undefined])).toThrow(TypeError);
  });
  it('drops undefined object properties', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
  it('returns 64 lowercase hex chars', () => {
    expect(proposalHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
