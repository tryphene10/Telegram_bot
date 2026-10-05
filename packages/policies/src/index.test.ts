import { describe, expect, it } from 'vitest';
import { POLICY_DECISIONS } from './index.js';

describe('policy decisions', () => {
  it('contains a fail-closed decision', () => {
    expect(POLICY_DECISIONS).toContain('DENY');
  });
});
