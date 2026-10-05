import { describe, expect, it, vi } from 'vitest';
import { AdaptivePlanRepository } from './adaptive-plan-repository.js';
import type { SqlClient } from './sql.js';

describe('AdaptivePlanRepository', () => {
  it('persists a complete plan through optimistic mission versioning', async () => {
    const plan = { id: 'plan-1', revision: 1, contextFingerprint: 'context-a' };
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [{ public_id: 'mission-1', version: 4, plan }],
    });
    const repository = new AdaptivePlanRepository({ query } as unknown as SqlClient);
    await expect(repository.save('mission-1', 3, plan)).resolves.toEqual({
      missionPublicId: 'mission-1',
      missionVersion: 4,
      plan,
    });
    expect(query.mock.calls[0]?.[0]).toContain('version = version + 1');
    expect(query.mock.calls[0]?.[1]).toEqual(['mission-1', 3, JSON.stringify(plan)]);
  });

  it('refuses a stale edit instead of overwriting another revision', async () => {
    const repository = new AdaptivePlanRepository({
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    } as unknown as SqlClient);
    await expect(repository.save('mission-1', 2, { id: 'stale' })).rejects.toThrow(
      'modified concurrently',
    );
  });
});
