import { describe, expect, it } from 'vitest';
import { AI_BOUNDARY } from './index.js';

describe('AI boundary foundation', () => {
  it('keeps cloud providers disabled', () => {
    expect(AI_BOUNDARY.cloudProvidersEnabled).toBe(false);
  });
});
