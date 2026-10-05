import { describe, expect, it, vi } from 'vitest';
import { ApplicationCatalogRepository } from './application-catalog-repository.js';
import type { SqlClient } from './sql.js';

const row = {
  public_id: 'app-1',
  app_key: 'fixture',
  display_name: 'Fixture',
  executable_path: 'C:\\Apps\\fixture.exe',
  executable_sha256: null,
  launch_profile: { windowTitles: ['Fixture'] },
  version_hint: null,
  enabled: false,
};

describe('ApplicationCatalogRepository', () => {
  it('registers changes in a disabled state pending explicit administration', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [row] });
    const repository = new ApplicationCatalogRepository({ query } as unknown as SqlClient);
    await expect(
      repository.register({
        machinePublicId: '11111111-1111-1111-1111-111111111111',
        appKey: 'fixture',
        displayName: 'Fixture',
        executablePath: 'C:\\Apps\\fixture.exe',
        launchProfile: { windowTitles: ['Fixture'] },
      }),
    ).resolves.toMatchObject({ appKey: 'fixture', enabled: false });
    expect(query.mock.calls[0]?.[0]).toContain('enabled = false');
  });

  it('enables explicitly and only resolves enabled machine-scoped entries', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ ...row, enabled: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ ...row, enabled: true }] });
    const repository = new ApplicationCatalogRepository({ query } as unknown as SqlClient);
    await expect(repository.setEnabled('app-1', true)).resolves.toMatchObject({ enabled: true });
    await expect(repository.findEnabled('machine-1', 'fixture')).resolves.toMatchObject({
      appKey: 'fixture',
    });
    expect(query.mock.calls[1]?.[0]).toContain('app.enabled = true');
    expect(query.mock.calls[1]?.[1]).toEqual(['machine-1', 'fixture']);
  });
});
