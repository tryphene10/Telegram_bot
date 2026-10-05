import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from './index.js';

describe('protocol foundation', () => {
  it('has an explicit version', () => {
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
