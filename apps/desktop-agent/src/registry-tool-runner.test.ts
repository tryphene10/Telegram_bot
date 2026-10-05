import { describe, expect, it, vi } from 'vitest';
import { objectSchema, ToolRegistry } from '@arcc/tools';
import { RegistryToolRunner } from './registry-tool-runner.js';

const schema = objectSchema<Record<string, unknown>>(
  (value): value is Record<string, unknown> => typeof value === 'object',
);

describe('RegistryToolRunner', () => {
  it('forwards the exact policy decision and action hash to the registry', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const runner = new RegistryToolRunner({ execute } as unknown as ToolRegistry);
    await expect(
      runner.run({
        executionId: 'e',
        idempotencyKey: 'i',
        authorizationId: 'auth',
        policyDecision: 'REQUIRE_APPROVAL',
        actionHash: 'a'.repeat(64),
        tool: 'files.read',
        parameters: {},
      }),
    ).resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledWith(
      'files.read',
      {},
      { decision: 'REQUIRE_APPROVAL', actionHash: 'a'.repeat(64), authorizationId: 'auth' },
    );
  });

  it('cannot bypass a DENY decision even when invoked directly', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'files.read',
      risk: 'LOW',
      limits: { timeoutMs: 100, maxInputBytes: 100, maxOutputBytes: 100 },
      input: schema,
      output: schema,
      execute: async () => ({ ok: true }),
    });
    const runner = new RegistryToolRunner(registry);
    await expect(
      runner.run({
        executionId: 'e',
        idempotencyKey: 'i',
        authorizationId: 'auth',
        policyDecision: 'DENY',
        actionHash: 'a'.repeat(64),
        tool: 'files.read',
        parameters: {},
      }),
    ).rejects.toMatchObject({ reason: 'policy_denied' });
  });
});
