import { describe, expect, it, vi } from 'vitest';
import { createFundamentalToolRegistry } from './fundamental-toolset.js';

describe('fundamental toolset', () => {
  it('registers only the bounded phase 08 tools with declared risks', () => {
    const registry = createFundamentalToolRegistry({
      files: {} as never,
      screenshots: {} as never,
      processes: async () => [],
    });
    expect(registry.descriptors().map(({ name, risk }) => [name, risk])).toEqual([
      ['files.read', 'LOW'],
      ['files.list', 'LOW'],
      ['files.search', 'LOW'],
      ['files.write', 'MEDIUM'],
      ['files.copy', 'MEDIUM'],
      ['files.move', 'MEDIUM'],
      ['files.remove', 'MEDIUM'],
      ['system.info', 'LOW'],
      ['system.processes', 'LOW'],
      ['screen.capture', 'MEDIUM'],
    ]);
    expect(
      registry
        .descriptors()
        .some(
          ({ name }) =>
            name.startsWith('terminal.') ||
            name.startsWith('git.') ||
            name.startsWith('docker.') ||
            name.startsWith('browser.'),
        ),
    ).toBe(false);
  });

  it('executes a real registered adapter only with an attached policy', async () => {
    const read = vi.fn(async () => ({ content: 'ok', bytes: 2 }));
    const registry = createFundamentalToolRegistry({
      files: { read } as never,
      screenshots: {} as never,
      processes: async () => [],
    });
    await expect(
      registry.execute(
        'files.read',
        { path: 'src/a.txt', maxBytes: 10 },
        { decision: 'ALLOW', actionHash: 'a'.repeat(64) },
      ),
    ).resolves.toEqual({ content: 'ok', bytes: 2 });
    await expect(
      registry.execute(
        'files.read',
        { path: 'src/a.txt', maxBytes: 10 },
        { decision: 'DENY', actionHash: 'a'.repeat(64) },
      ),
    ).rejects.toMatchObject({ reason: 'policy_denied' });
    expect(read).toHaveBeenCalledOnce();
  });
});
