import { describe, expect, it, vi } from 'vitest';
import { objectSchema, ToolRegistry } from './tool-registry.js';

interface Input extends Record<string, unknown> {
  value: string;
}
interface Output extends Record<string, unknown> {
  result: string;
}

const input = objectSchema<Input>((value): value is Input => typeof value.value === 'string');
const output = objectSchema<Output>((value): value is Output => typeof value.result === 'string');
const allow = { decision: 'ALLOW' as const, actionHash: 'a'.repeat(64) };

describe('ToolRegistry', () => {
  it('runs a registered bounded tool with an attached policy decision', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'files.read',
      risk: 'LOW',
      limits: { timeoutMs: 100, maxInputBytes: 100, maxOutputBytes: 100 },
      input,
      output,
      execute: async ({ value }) => ({ result: value }),
    });
    await expect(registry.execute('files.read', { value: 'ok' }, allow)).resolves.toEqual({
      result: 'ok',
    });
  });

  it.each([
    [{ decision: 'DENY' as const, actionHash: 'a'.repeat(64) }, 'policy_denied'],
    [
      { decision: 'REQUIRE_APPROVAL' as const, actionHash: 'a'.repeat(64) },
      'approval_not_consumed',
    ],
    [{ decision: 'ALLOW' as const, actionHash: 'bad' }, 'invalid_action_hash'],
  ])('fails closed for invalid authorization context', async (authorization, reason) => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'files.read',
      risk: 'LOW',
      limits: { timeoutMs: 100, maxInputBytes: 100, maxOutputBytes: 100 },
      input,
      output,
      execute: async () => ({ result: 'x' }),
    });
    await expect(
      registry.execute('files.read', { value: 'x' }, authorization),
    ).rejects.toMatchObject({ reason });
  });

  it('enforces schemas, sizes, preconditions and timeouts', async () => {
    const registry = new ToolRegistry();
    const precondition = vi.fn(async () => undefined);
    registry.register({
      name: 'files.search',
      risk: 'LOW',
      limits: { timeoutMs: 5, maxInputBytes: 30, maxOutputBytes: 30 },
      input,
      output,
      precondition,
      execute: async () =>
        new Promise((resolve) => setTimeout(() => resolve({ result: 'late' }), 30)),
    });
    await expect(registry.execute('files.search', { wrong: true }, allow)).rejects.toMatchObject({
      reason: 'invalid_input',
    });
    await expect(
      registry.execute('files.search', { value: 'x'.repeat(50) }, allow),
    ).rejects.toMatchObject({ reason: 'input_too_large' });
    await expect(registry.execute('files.search', { value: 'ok' }, allow)).rejects.toMatchObject({
      reason: 'timeout',
    });
    expect(precondition).toHaveBeenCalledOnce();
  });
});
