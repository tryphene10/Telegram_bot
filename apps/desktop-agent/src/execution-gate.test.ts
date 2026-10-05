import { describe, expect, it, vi } from 'vitest';
import { DesktopExecutionGate, type ToolExecutionRequest } from './execution-gate.js';

const request: ToolExecutionRequest = {
  executionId: 'execution-1',
  idempotencyKey: 'key-1',
  authorizationId: 'authorization-1',
  policyDecision: 'ALLOW',
  actionHash: 'a'.repeat(64),
  tool: 'future.safe.tool',
  parameters: {},
};

describe('DesktopExecutionGate', () => {
  it('never executes an identical non-idempotent operation twice', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    const gate = new DesktopExecutionGate({ verify: vi.fn().mockResolvedValue(true) }, { run });
    expect((await gate.handle(request)).status).toBe('COMPLETED');
    expect((await gate.handle(request)).status).toBe('DUPLICATE');
    expect(run).toHaveBeenCalledOnce();
  });

  it('rejects identifier conflicts and missing exact authorization', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    const gate = new DesktopExecutionGate({ verify: vi.fn().mockResolvedValue(true) }, { run });
    await gate.handle(request);
    await expect(gate.handle({ ...request, idempotencyKey: 'different' })).rejects.toThrow(
      'Execution identifier conflict',
    );
    const denied = new DesktopExecutionGate({ verify: vi.fn().mockResolvedValue(false) }, { run });
    await expect(denied.handle({ ...request, executionId: 'execution-2' })).rejects.toThrow(
      'Exact execution authorization required',
    );
  });
});
