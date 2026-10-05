import { describe, expect, it, vi } from 'vitest';
import { DeterministicMissionEngine } from './mission-engine.js';
import {
  InMemoryDurableMissionStore,
  type MissionAggregate,
  type MissionDefinition,
} from './mission-runtime.js';

const definition: MissionDefinition = {
  idempotencyKey: 'telegram:update:90001',
  projectId: 'project-1',
  objective: 'Implement the requested change',
  context: {},
  successCriteria: ['all planned steps complete'],
  definitionOfDone: ['objective verification passes'],
};

const plan = [
  {
    id: 'change',
    title: 'Apply change',
    dependencies: [],
    maxAttempts: 3,
    maxLoops: 3,
    exitCriteria: ['change applied'],
  },
  {
    id: 'verify',
    title: 'Run checks',
    dependencies: ['change'],
    maxAttempts: 3,
    maxLoops: 3,
    exitCriteria: ['checks pass'],
  },
] as const;

function engine(
  store = new InMemoryDurableMissionStore(),
  execute = vi.fn(async () => ({ status: 'COMPLETED' as const, result: { ok: true } })),
  verify = vi.fn(async () => ({ passed: true, evidence: ['tests:pass'], remainingRisks: [] })),
) {
  return {
    store,
    execute,
    verify,
    runtime: new DeterministicMissionEngine(
      store,
      { plan: vi.fn(async () => plan) },
      { execute },
      { verify },
      100,
    ),
  };
}

describe('DeterministicMissionEngine', () => {
  it('executes dependencies in order and completes only with objective evidence', async () => {
    const values = engine();
    values.runtime.submit(definition);
    const result = await values.runtime.runNext('worker-1');
    expect(result?.status).toBe('COMPLETED');
    expect(values.execute.mock.calls.map(([input]) => input.step.id)).toEqual(['change', 'verify']);
    expect(result?.verificationEvidence).toEqual(['tests:pass']);
    expect(result?.finalReport).toContain('tests:pass');
    expect(result?.timeline.map(({ sequence }) => sequence)).toEqual(
      result?.timeline.map((_, index) => index + 1),
    );
  });

  it('blocks completion with a cause and expected action when evidence is absent', async () => {
    const values = engine(
      new InMemoryDurableMissionStore(),
      vi.fn(async () => ({ status: 'COMPLETED' as const, result: {} })),
      vi.fn(async () => ({ passed: true, evidence: [], remainingRisks: [] })),
    );
    values.runtime.submit(definition);
    const result = await values.runtime.runNext('worker');
    expect(result).toMatchObject({
      status: 'BLOCKED',
      blocked: {
        cause: 'objective_verification_failed',
        expectedAction: 'Fournir une verification objective reussie',
      },
    });
  });

  it('pauses, resumes and cancels coherently', async () => {
    const values = engine();
    const queued = values.runtime.submit(definition);
    expect(values.runtime.pause(queued.id).status).toBe('PAUSED');
    expect(values.runtime.resume(queued.id).status).toBe('QUEUED');
    expect(values.runtime.cancel(queued.id).status).toBe('CANCELLED');
    expect(() => values.runtime.resume(queued.id)).toThrow('mission_not_resumable');
  });

  it('waits for approval then resumes without completing early', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ status: 'WAITING_APPROVAL', approvalId: 'approval-1' })
      .mockResolvedValue({ status: 'COMPLETED', result: { ok: true } });
    const values = engine(new InMemoryDurableMissionStore(), execute);
    const submitted = values.runtime.submit(definition);
    expect((await values.runtime.runNext('worker'))?.status).toBe('WAITING_APPROVAL');
    values.runtime.resume(submitted.id);
    expect((await values.runtime.runNext('worker'))?.status).toBe('COMPLETED');
  });

  it('blocks after restart instead of duplicating an action with unknown outcome', async () => {
    let now = 1_000;
    const store = new InMemoryDurableMissionStore(() => now);
    const mission = store.create(definition);
    const claimed = store.claimNext('old-worker', 50) as MissionAggregate;
    store.save(
      claimed,
      {
        status: 'RUNNING',
        plan: [
          {
            ...plan[0],
            status: 'RUNNING',
            attempts: 1,
            loops: 1,
            activeActionKey: 'action-unknown',
            activeActionHash: 'a'.repeat(64),
          },
        ],
      },
      'STEP_STARTED',
    );
    now += 100;
    const values = engine(store);
    const result = await values.runtime.runNext('new-worker');
    expect(result).toMatchObject({
      id: mission.id,
      status: 'BLOCKED',
      blocked: { cause: 'action_outcome_unknown_after_restart' },
    });
    expect(values.execute).not.toHaveBeenCalled();
  });

  it('uses a durable receipt after restart without executing the action twice', async () => {
    let now = 2_000;
    const store = new InMemoryDurableMissionStore(() => now);
    store.create(definition);
    const claimed = store.claimNext('old-worker', 50) as MissionAggregate;
    const step = {
      ...plan[0],
      status: 'RUNNING' as const,
      attempts: 1,
      loops: 1,
      activeActionKey: 'action-complete',
      activeActionHash: 'b'.repeat(64),
    };
    store.save(claimed, { status: 'RUNNING', plan: [step] }, 'STEP_STARTED');
    store.completeAction({
      key: 'action-complete',
      actionHash: 'b'.repeat(64),
      result: { ok: true },
    });
    now += 100;
    const values = engine(store);
    const result = await values.runtime.runNext('new-worker');
    expect(result?.status).toBe('COMPLETED');
    expect(values.execute).not.toHaveBeenCalled();
  });

  it('propagates pause cancellation to the active tool signal', async () => {
    let signalSeen: AbortSignal | undefined;
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const execute = vi.fn(
      async ({ signal }: { signal: AbortSignal }) =>
        await new Promise<never>((_resolve, reject) => {
          signalSeen = signal;
          started();
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    );
    const values = engine(new InMemoryDurableMissionStore(), execute as never);
    const mission = values.runtime.submit(definition);
    const running = values.runtime.runNext('worker');
    await didStart;
    expect(values.runtime.pause(mission.id).status).toBe('PAUSED');
    expect(signalSeen?.aborted).toBe(true);
    await expect(running).rejects.toThrow('aborted');
    expect(values.store.get(mission.id).status).toBe('PAUSED');
  });
});
