import { ToolRegistry, type CompiledTerminalProfile } from '@arcc/tools';
import { describe, expect, it, vi } from 'vitest';
import { registerSecureTerminalTools, terminalToolName } from './terminal-toolset.js';

const profile = {
  name: 'check',
  network: 'DENY',
  kind: 'NORMAL',
  mutatesProject: false,
} as CompiledTerminalProfile;

describe('terminal toolset', () => {
  it.each([
    [{ ...profile }, 'terminal.readonly'],
    [{ ...profile, mutatesProject: true }, 'terminal.mutate'],
    [{ ...profile, kind: 'DEPENDENCY_INSTALL' }, 'terminal.install'],
    [{ ...profile, kind: 'PERSISTENT_PROCESS' }, 'terminal.persistent'],
    [{ ...profile, network: 'ALLOW' }, 'terminal.network'],
  ] as const)('maps profiles to a policy-visible tool', (value, expected) => {
    expect(terminalToolName(value as CompiledTerminalProfile)).toBe(expected);
  });

  it('registers no arbitrary terminal and rejects a risk mismatch', async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({ status: 'COMPLETED', exitCode: 0 }));
    registerSecureTerminalTools(registry, {
      resolveProfile: async () => profile,
      runner: { execute } as never,
    });
    expect(registry.descriptors().map(({ name }) => name)).toEqual([
      'terminal.readonly',
      'terminal.mutate',
      'terminal.install',
      'terminal.persistent',
      'terminal.network',
    ]);
    const authorization = { decision: 'ALLOW' as const, actionHash: 'a'.repeat(64) };
    await expect(
      registry.execute('terminal.readonly', { profile: 'check' }, authorization),
    ).resolves.toMatchObject({ exitCode: 0 });
    await expect(
      registry.execute('terminal.mutate', { profile: 'check' }, authorization),
    ).rejects.toThrow('terminal_profile_risk_mismatch');
    expect(execute).toHaveBeenCalledOnce();
  });
});
