import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '@arcc/tools';
import { registerControlledBrowserTools } from './browser-toolset.js';

describe('browser toolset', () => {
  it('binds the persisted manifest and forwards the registry authorization', async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({
      trust: 'DATA_ONLY' as const,
      classification: 'LOCAL_ONLY' as const,
    }));
    const manifest = {
      version: 1 as const,
      projectId: 'project',
      machineId: 'machine',
      rootPath: 'C:\\project',
      stack: [],
      environments: ['LOCAL'],
      commands: {},
      allowedPaths: ['.'],
      deniedPaths: ['.git'],
      protectedFiles: ['.env'],
      directoryLimits: { '.': { maxFiles: 10, maxBytes: 1024 } },
    };
    registerControlledBrowserTools(registry, { execute } as never, manifest);
    const authorization = {
      decision: 'REQUIRE_STRONG_APPROVAL' as const,
      actionHash: 'a'.repeat(64),
      authorizationId: 'approval-1',
    };
    await registry.execute(
      'browser.upload',
      { action: 'UPLOAD', url: 'https://example.com', manifest: { invalid: true } },
      authorization,
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ manifest, registryAuthorization: authorization }),
    );
  });

  it('registers risk-separated tools and rejects action/tool confusion', async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({
      trust: 'DATA_ONLY' as const,
      classification: 'LOCAL_ONLY' as const,
    }));
    registerControlledBrowserTools(registry, { execute } as never);
    expect(registry.descriptors().map(({ name, risk }) => `${name}:${risk}`)).toEqual([
      'browser.read:LOW',
      'browser.download:MEDIUM',
      'browser.interact:MEDIUM',
      'browser.upload:HIGH',
      'browser.external:CRITICAL',
    ]);
    await expect(
      registry.execute(
        'browser.read',
        { action: 'PUBLISH', url: 'https://example.com' },
        {
          decision: 'ALLOW',
          actionHash: 'a'.repeat(64),
        },
      ),
    ).rejects.toThrow('browser_action_risk_mismatch');
    expect(execute).not.toHaveBeenCalled();
  });
});
