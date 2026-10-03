import { describe, expect, it } from 'vitest';
import { intEnv, requireEnv } from '../../src/config.js';

describe('config', () => {
  it('returns a present variable', () => {
    expect(requireEnv({ A: 'x' }, 'A')).toBe('x');
  });
  it('throws naming the missing variable', () => {
    expect(() => requireEnv({}, 'RUNS_TABLE')).toThrow('Missing environment variable RUNS_TABLE');
  });
  it('treats empty strings as missing', () => {
    expect(() => requireEnv({ A: '' }, 'A')).toThrow('Missing environment variable A');
  });
  it('parses integers with a default', () => {
    expect(intEnv({ N: '42' }, 'N', 7)).toBe(42);
    expect(intEnv({}, 'N', 7)).toBe(7);
    expect(() => intEnv({ N: '4.2' }, 'N', 7)).toThrow('N must be an integer');
  });
});
