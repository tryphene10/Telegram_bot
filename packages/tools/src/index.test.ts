import { describe, expect, it } from 'vitest';
import { EMPTY_TOOL_REGISTRY } from './index.js';

describe('tool registry foundation', () => {
  it('enables no tool before the policy phase', () => {
    expect(EMPTY_TOOL_REGISTRY).toHaveLength(0);
  });
});
