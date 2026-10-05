import { describe, expect, it } from 'vitest';
import { DATA_CLASSIFICATIONS } from './index.js';

describe('data classifications', () => {
  it('contains the fail-closed local class', () => {
    expect(DATA_CLASSIFICATIONS).toContain('LOCAL_ONLY');
  });
});
