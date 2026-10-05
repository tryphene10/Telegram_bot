import { describe, expect, it, vi } from 'vitest';
import { MissionRepository, type MissionRecord } from './mission-repository.js';
import { ConcurrentUpdateError, type SqlClient } from './sql.js';

const mission: MissionRecord = {
  publicId: '87d5f282-7c3f-46a2-8eed-72ff6877958b',
  status: 'RUNNING',
  version: 3,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('MissionRepository', () => {
  it('uses status and version for optimistic concurrency', async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          public_id: mission.publicId,
          status: 'VERIFYING',
          version: 4,
          updated_at: new Date('2026-01-01T00:00:01Z'),
        },
      ],
    });
    const repository = new MissionRepository({ query } as SqlClient);
    const updated = await repository.transition(mission, 'VERIFYING');
    expect(updated.version).toBe(4);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('version = $4'), [
      'VERIFYING',
      mission.publicId,
      'RUNNING',
      3,
    ]);
  });

  it('reports a concurrent update when no row is changed', async () => {
    const repository = new MissionRepository({
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    } as unknown as SqlClient);
    await expect(repository.transition(mission, 'VERIFYING')).rejects.toBeInstanceOf(
      ConcurrentUpdateError,
    );
  });

  it('rejects an illegal transition before querying PostgreSQL', async () => {
    const query = vi.fn();
    const repository = new MissionRepository({ query } as unknown as SqlClient);
    await expect(repository.transition(mission, 'COMPLETED')).rejects.toThrow(
      'Invalid mission transition',
    );
    expect(query).not.toHaveBeenCalled();
  });
});
