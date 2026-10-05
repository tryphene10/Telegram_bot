import { describe, expect, it, vi } from 'vitest';
import {
  AdaptiveMissionStepExecutor,
  RoutedMissionStepExecutor,
} from './adaptive-mission-executor.js';
import type { MissionAggregate, MissionStep } from './mission-runtime.js';

const step = {
  id: 'desktop',
  title: 'Operate desktop',
  dependencies: [],
  maxAttempts: 2,
  maxLoops: 2,
  exitCriteria: ['verified'],
  executionKind: 'ADAPTIVE_DESKTOP',
  adaptivePlanId: 'adaptive-plan-1',
  status: 'RUNNING',
  attempts: 1,
  loops: 1,
} satisfies MissionStep;

const input = {
  mission: { id: 'mission-1' } as MissionAggregate,
  step,
  idempotencyKey: 'mission-1:desktop:1',
  actionHash: 'a'.repeat(64),
  signal: new AbortController().signal,
};

describe('AdaptiveMissionStepExecutor', () => {
  it('connects verified adaptive execution to the durable mission result', async () => {
    const execute = vi.fn(async () => ({
      status: 'COMPLETED' as const,
      evidence: ['audit:event-1'],
      completedStepIds: ['open', 'save'],
      actions: 3,
      retries: 1,
      checkpointId: 'checkpoint-2',
    }));
    await expect(new AdaptiveMissionStepExecutor({ execute }).execute(input)).resolves.toEqual({
      status: 'COMPLETED',
      result: {
        evidence: ['audit:event-1'],
        completedStepIds: ['open', 'save'],
        actions: 3,
        retries: 1,
        checkpointId: 'checkpoint-2',
      },
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ adaptivePlanId: 'adaptive-plan-1' }),
    );
  });

  it.each([
    ['STALE_CONTEXT', 'adaptive_stale_context'],
    ['USER_ACTIVITY', 'adaptive_user_activity'],
    ['UNKNOWN_RESULT', 'adaptive_unknown_result'],
  ] as const)('maps %s to an explicit durable block', async (cause, expectedCause) => {
    const runtime = new AdaptiveMissionStepExecutor({
      execute: vi.fn(async () => ({ status: 'BLOCKED' as const, cause })),
    });
    await expect(runtime.execute(input)).resolves.toMatchObject({
      status: 'BLOCKED',
      cause: expectedCause,
    });
  });

  it('routes desktop steps without changing specialist execution', async () => {
    const specialist = {
      execute: vi.fn(async () => ({ status: 'COMPLETED' as const, result: {} })),
    };
    const adaptive = { execute: vi.fn(async () => ({ status: 'COMPLETED' as const, result: {} })) };
    const router = new RoutedMissionStepExecutor(specialist, adaptive);
    await router.execute(input);
    await router.execute({ ...input, step: { ...step, executionKind: 'SPECIALIST' } });
    expect(adaptive.execute).toHaveBeenCalledTimes(1);
    expect(specialist.execute).toHaveBeenCalledTimes(1);
  });
});
