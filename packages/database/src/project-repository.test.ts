import { describe, expect, it, vi } from 'vitest';
import { ProjectRepository } from './project-repository.js';
import { ConcurrentUpdateError, type SqlClient } from './sql.js';

describe('ProjectRepository', () => {
  it('arbitrates concurrent manifest updates by version', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const repository = new ProjectRepository({ query } as unknown as SqlClient);
    await expect(repository.updateManifest('project-id', 2, 1, {})).rejects.toBeInstanceOf(
      ConcurrentUpdateError,
    );
    expect(query).toHaveBeenCalledWith(expect.stringContaining('version = $4'), [
      1,
      {},
      'project-id',
      2,
    ]);
  });

  it('only hard-deletes an explicitly archived matching revision', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const repository = new ProjectRepository({ query } as unknown as SqlClient);
    await repository.deleteArchived('project-id', 4);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'ARCHIVED'"), [
      'project-id',
      4,
    ]);
  });
});
