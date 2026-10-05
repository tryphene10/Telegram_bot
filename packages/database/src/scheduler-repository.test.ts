import { describe, expect, it, vi } from 'vitest';
import { SchedulerRepository } from './scheduler-repository.js';
import type { SqlClient } from './sql.js';
describe('SchedulerRepository', () => {
  it('materializes idempotently and claims FIFO with SKIP LOCKED and quotas', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            public_id: 'o1',
            schedule_id: 's1',
            occurrence_key: 'k1',
            idempotency_key: 'schedule:s1:k1',
            project_id: 'p1',
            autonomy_level: 'EXECUTE_SAFE',
            risk: 'LOW',
            mission_template: { goal: 'x' },
            attempts: 1,
            max_attempts: 3,
            pause_generation: '0',
          },
        ],
      });
    const repository = new SchedulerRepository({ query } as unknown as SqlClient);
    await expect(
      repository.materialize('s1', [{ key: 'k1', dueAt: '2026-01-01T00:00:00Z' }]),
    ).resolves.toBe(1);
    expect(query.mock.calls[0]?.[0]).toContain(
      'on conflict(schedule_id,occurrence_key) do nothing',
    );
    await expect(repository.claim('worker-1', 60)).resolves.toMatchObject({
      id: 'o1',
      pauseGeneration: 0,
    });
    const sql = String(query.mock.calls[1]?.[0]);
    expect(sql).toContain('for update of o skip locked');
    expect(sql).toContain('global_concurrency');
    expect(sql).toContain('project_concurrency');
    expect(sql).toContain('daily_mission_budget');
    expect(sql).toContain('order by o.due_at,o.submission_sequence');
  });
  it('recovers uncertain expired work without replay', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 2, rows: [] });
    await expect(
      new SchedulerRepository({ query } as unknown as SqlClient).recoverExpired(),
    ).resolves.toBe(2);
    expect(query.mock.calls[0]?.[0]).toContain("status='UNKNOWN'");
    expect(query.mock.calls[0]?.[0]).toContain('LEASE_EXPIRED_OUTCOME_UNKNOWN');
  });
  it('claims monitors atomically and exposes sanitized diagnostics', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            paused: false,
            autonomy: 'EXECUTE_SAFE',
            pending: '1',
            running: '0',
            unknown: '0',
            open_incidents: '1',
          },
        ],
      });
    const repository = new SchedulerRepository({ query } as unknown as SqlClient);
    await repository.claimMonitor('monitor-worker', 30);
    expect(query.mock.calls[0]?.[0]).toContain('for update skip locked');
    await expect(repository.diagnostics()).resolves.toMatchObject({ autonomy: 'EXECUTE_SAFE' });
  });
});
