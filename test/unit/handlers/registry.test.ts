import { describe, expect, it } from 'vitest';
import { HANDLER_NAMES, REGISTRY } from '../../../src/handlers/registry.js';

describe('registry', () => {
  it('has nine handlers, each with fromEnv', () => {
    expect(HANDLER_NAMES).toHaveLength(9);
    expect(Object.keys(REGISTRY).sort()).toEqual([...HANDLER_NAMES].sort());
    for (const name of HANDLER_NAMES) expect(typeof REGISTRY[name].fromEnv).toBe('function');
  });
});
