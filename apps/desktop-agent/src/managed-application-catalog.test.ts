import { describe, expect, it, vi } from 'vitest';
import type { WindowSnapshot } from './computer-use-core.js';
import {
  ManagedApplicationCatalog,
  buildProcessIdentityScript,
} from './managed-application-catalog.js';

const window: WindowSnapshot = {
  handle: '42',
  processId: 100,
  processName: 'fixture.exe',
  title: 'Fixture - document',
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  monitorId: '1',
  dpi: 96,
  visible: true,
  enabled: true,
  foreground: true,
};

function catalog(overrides: Readonly<Record<string, unknown>> = {}) {
  const source = {
    findEnabled: vi.fn(async () => ({
      appKey: 'fixture',
      executablePath: 'C:\\Apps\\fixture.exe',
      launchProfile: { windowTitlePrefixes: ['Fixture -'] },
      ...overrides,
    })),
  };
  const identities = {
    inspect: vi.fn(async () => ({
      processId: 100,
      executablePath: 'c:\\apps\\fixture.exe',
      executableSha256: 'a'.repeat(64),
    })),
  };
  return { catalog: new ManagedApplicationCatalog(source, identities), source, identities };
}

describe('ManagedApplicationCatalog', () => {
  it('authorizes only the enabled definition matching process identity and title rules', async () => {
    const values = catalog({ executableSha256: 'a'.repeat(64) });
    await expect(values.catalog.authorize('fixture', window)).resolves.toBe(true);
    expect(values.identities.inspect).toHaveBeenCalledWith(100, true);
  });

  it('fails closed for path, hash, title and malformed profile mismatches', async () => {
    await expect(
      catalog({ executablePath: 'C:\\Other\\fixture.exe' }).catalog.authorize('fixture', window),
    ).resolves.toBe(false);
    await expect(
      catalog({ executableSha256: 'b'.repeat(64) }).catalog.authorize('fixture', window),
    ).resolves.toBe(false);
    await expect(
      catalog({ launchProfile: { windowTitles: ['Other'] } }).catalog.authorize('fixture', window),
    ).resolves.toBe(false);
    await expect(
      catalog({ launchProfile: { windowTitles: 'Fixture - document' } }).catalog.authorize(
        'fixture',
        window,
      ),
    ).resolves.toBe(false);
  });

  it('builds a bounded read-only Windows identity query', () => {
    const script = buildProcessIdentityScript(100, true);
    expect(script).toContain('ProcessId = 100');
    expect(script).toContain('Get-FileHash -LiteralPath');
    expect(() => buildProcessIdentityScript(0, false)).toThrow('invalid_process_id');
  });
});
