import { describe, expect, it } from 'vitest';
import { AGENT_BOUNDARY } from './index.js';

describe('agent boundary foundation', () => {
  it('cannot decide policy or execute directly', () => {
    expect(AGENT_BOUNDARY).toEqual({ mayDecidePolicy: false, mayExecuteToolsDirectly: false });
  });
});
