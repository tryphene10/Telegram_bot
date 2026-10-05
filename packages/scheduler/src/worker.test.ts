import { describe, expect, it, vi } from 'vitest';
import { SchedulerWorker, type OccurrenceStore } from './worker.js';
import type { ClaimedOccurrence } from './types.js';

function fixture(overrides: Partial<ClaimedOccurrence> = {}) {
  const occurrence: ClaimedOccurrence = {
    id: 'o1',
    scheduleId: 's1',
    occurrenceKey: 'k1',
    idempotencyKey: 'schedule:s1:k1',
    autonomyLevel: 'EXECUTE_SAFE',
    risk: 'LOW',
    missionTemplate: { goal: 'test' },
    attempts: 1,
    maxAttempts: 3,
    pauseGeneration: 0,
    ...overrides,
  };
  const store: OccurrenceStore = {
    control: vi.fn(async () => ({ globallyPaused: false, pauseGeneration: 0 })),
    claim: vi.fn(async () => occurrence),
    heartbeat: vi.fn(async () => true),
    complete: vi.fn(async () => undefined),
    block: vi.fn(async () => undefined),
    waitApproval: vi.fn(async () => undefined),
    unknown: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  };
  const policy = {
    evaluate: vi.fn(async () => ({
      decision: 'ALLOW' as const,
      reason: 'risk_low',
      explanation: '',
      actionHash: 'fresh-hash',
    })),
  };
  const missions = { execute: vi.fn(async () => ({ missionId: 'm1' })) };
  const audit = { record: vi.fn(async () => undefined) };
  return {
    occurrence,
    store,
    policy,
    missions,
    worker: new SchedulerWorker(store, policy, missions, audit, 'w1'),
  };
}
describe('SchedulerWorker', () => {
  it('re-evaluates policy and executes with an idempotency key', async () => {
    const value = fixture();
    await expect(value.worker.runOnce()).resolves.toBe('COMPLETED');
    expect(value.policy.evaluate).toHaveBeenCalledWith(value.occurrence);
    expect(value.missions.execute).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'schedule:s1:k1' }),
    );
  });
  it('requires a fresh approval for each critical occurrence', async () => {
    const value = fixture({ risk: 'HIGH', autonomyLevel: 'AUTONOMOUS' });
    value.policy.evaluate.mockResolvedValueOnce({
      decision: 'REQUIRE_STRONG_APPROVAL',
      reason: 'fresh_approval_required',
      explanation: '',
      actionHash: 'new-occurrence-hash',
    });
    await expect(value.worker.runOnce()).resolves.toBe('WAITING_APPROVAL');
    expect(value.store.waitApproval).toHaveBeenCalledWith('o1', 'w1', 'new-occurrence-hash');
    expect(value.missions.execute).not.toHaveBeenCalled();
  });
  it('honors pause before claiming and after policy evaluation', async () => {
    const paused = fixture();
    paused.store.control = vi.fn(async () => ({ globallyPaused: true, pauseGeneration: 1 }));
    await expect(paused.worker.runOnce()).resolves.toBe('PAUSED');
    expect(paused.store.claim).not.toHaveBeenCalled();
    const during = fixture();
    let call = 0;
    during.store.control = vi.fn(async () =>
      call++ === 0
        ? { globallyPaused: false, pauseGeneration: 0 }
        : { globallyPaused: true, pauseGeneration: 1 },
    );
    await expect(during.worker.runOnce()).resolves.toBe('BLOCKED');
    expect(during.missions.execute).not.toHaveBeenCalled();
  });
  it('marks uncertain action results unknown instead of replaying', async () => {
    const value = fixture();
    value.missions.execute.mockRejectedValueOnce(new Error('connection lost'));
    await expect(value.worker.runOnce()).resolves.toBe('UNKNOWN');
    expect(value.store.unknown).toHaveBeenCalledWith('o1', 'w1', 'EXECUTION_OUTCOME_UNKNOWN');
  });
});
