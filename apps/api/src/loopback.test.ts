import { describe, expect, it } from 'vitest';
import { validateApiHost } from './index.js';

describe('API listener boundary', () => {
  it('accepts loopback addresses and rejects network exposure', () => {
    expect(validateApiHost('127.0.0.1')).toBe('127.0.0.1');
    expect(validateApiHost('::1')).toBe('::1');
    expect(() => validateApiHost('0.0.0.0')).toThrow('api_loopback_only');
    expect(() => validateApiHost('192.168.1.10')).toThrow('api_loopback_only');
  });
});
