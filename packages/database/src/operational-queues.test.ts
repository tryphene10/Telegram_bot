import { describe, expect, it, vi } from 'vitest';
import { OperationalQueueRepository } from './operational-queues.js';
import type { SqlClient } from './sql.js';

describe('OperationalQueueRepository', () => {
  it.each([
    ['claimTool', "status = 'AUTHORIZED'"],
    ['claimNotification', "status = 'PENDING'"],
    ['claimScheduledTask', 'enabled = true'],
  ] as const)('claims %s atomically with skip locked', async (method, predicate) => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [{ public_id: 'job', mission_public_id: null, payload: {} }],
    });
    const repository = new OperationalQueueRepository({ query } as SqlClient);
    await repository[method]('worker');
    expect(query.mock.calls[0]?.[0]).toContain('for update skip locked');
    expect(query.mock.calls[0]?.[0]).toContain(predicate);
  });

  it('lists approvals without consuming the user decision', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    await new OperationalQueueRepository({ query } as SqlClient).pendingApprovals('mission');
    expect(query.mock.calls[0]?.[0]).toContain("a.status = 'PENDING'");
    expect(query.mock.calls[0]?.[0]).not.toContain('update approvals');
  });

  it('recovers expired tool jobs and caps retries', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 2, rows: [] });
    await expect(
      new OperationalQueueRepository({ query } as SqlClient).recoverExpiredTools(),
    ).resolves.toBe(2);
    expect(query.mock.calls[0]?.[0]).toContain("attempts >= 20 then 'FAILED'");
  });
});
