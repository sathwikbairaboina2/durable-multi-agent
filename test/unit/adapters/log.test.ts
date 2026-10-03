import { describe, expect, it } from 'vitest';
import { captureLogs, log } from '../../../src/adapters/log.js';

describe('log', () => {
  it('redacts token-like keys at any depth', () => {
    const cap = captureLogs();
    try {
      log('info', 'x', { taskToken: 'SECRET', nested: { TaskToken: 'S2' }, list: [{ taskToken: 'S3' }], keep: 'visible' });
    } finally {
      cap.restore();
    }
    const line = cap.lines.join('\n');
    expect(line).not.toContain('SECRET');
    expect(line).not.toContain('S2');
    expect(line).not.toContain('S3');
    expect(line).toContain('visible');
  });
});
