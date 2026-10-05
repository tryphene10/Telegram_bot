import { describe, expect, it, vi } from 'vitest';
import { SchedulerRuntime } from './runtime.js';
import type { SchedulerWorker } from './worker.js';
describe('SchedulerRuntime recovery', () => {
  it('recovers durable work, catches up and advances without an in-memory source of truth', async () => {
    const store = {
      recoverExpired: vi.fn(async () => 1),
      dueSchedules: vi.fn(async () => [
        {
          id: 's1',
          triggerType: 'INTERVAL' as const,
          expression: 'PT15M',
          timezone: 'UTC',
          catchUpPolicy: 'LATEST_ONLY' as const,
          catchUpLimit: 1,
          nextRunAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
      materialize: vi.fn(async () => 1),
      advanceSchedule: vi.fn(async () => undefined),
    };
    const worker = {
      runOnce: vi.fn(async () => 'COMPLETED' as const),
    } as unknown as SchedulerWorker;
    const audit = { record: vi.fn(async () => undefined) };
    const runtime = new SchedulerRuntime(
      store,
      worker,
      audit,
      () => new Date('2026-01-01T00:31:00Z'),
    );
    await expect(runtime.restore()).resolves.toBe(1);
    await expect(runtime.runCycle()).resolves.toEqual({ materialized: 1, worker: 'COMPLETED' });
    expect(store.materialize).toHaveBeenCalledWith('s1', [
      { key: '2026-01-01T00:30:00.000Z', dueAt: '2026-01-01T00:30:00.000Z' },
    ]);
    expect(store.advanceSchedule).toHaveBeenCalledWith('s1', '2026-01-01T00:45:00.000Z');
  });
});
