import { describe, expect, it } from 'vitest';
import { webDashboard } from './index.js';

describe('web dashboard foundation', () => {
  it('binds to loopback by default', () => {
    expect(webDashboard.bindAddress).toBe('127.0.0.1');
  });
});
