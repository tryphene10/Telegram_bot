import { describe, expect, it, vi } from 'vitest';
import {
  AdaptiveComputerUseRunner,
  AdaptivePlanService,
  AdaptiveStrategyError,
  DryRunService,
  HumanTakeoverController,
  hashAdaptivePlan,
  type AdaptivePlan,
  type AdaptivePlanDraft,
} from './adaptive-computer-use.js';

const plan: AdaptivePlan = {
  id: 'plan-1',
  revision: 1,
  contextFingerprint: 'context-a',
  objective: 'Configure the fixture',
  constraints: ['No raw input'],
  deliverables: ['Verified settings'],
  assumptions: ['Fixture is installed'],
  missingInformation: [],
  createdAt: '2026-10-01T12:00:00.000Z',
  steps: [
    {
      id: 'open-settings',
      title: 'Open settings',
      required: true,
      maxAttempts: 2,
      successCriterion: 'settings visible',
      applications: ['fixture'],
      files: [],
      strategies: [
        { id: 'vision', channel: 'VISION_INPUT', risk: 'MEDIUM', requiresApproval: true },
        { id: 'uia', channel: 'UIA', risk: 'LOW', requiresApproval: false },
      ],
    },
  ],
};

const draft: AdaptivePlanDraft = {
  contextFingerprint: plan.contextFingerprint,
  objective: plan.objective,
  constraints: plan.constraints,
  deliverables: plan.deliverables,
  assumptions: plan.assumptions,
  missingInformation: plan.missingInformation,
  steps: plan.steps,
};

describe('AdaptivePlanService', () => {
  it('creates an editable versioned plan and changes its bound hash on revision', () => {
    const service = new AdaptivePlanService(
      () => 'plan-created',
      () => new Date('2026-10-01T12:00:00.000Z'),
    );
    const created = service.create(draft);
    const revised = service.revise(created, {
      ...draft,
      assumptions: ['Fixture is installed', 'Operator is available'],
    });
    expect(created).toMatchObject({ id: 'plan-created', revision: 1 });
    expect(revised).toMatchObject({ id: 'plan-created', revision: 2 });
    expect(hashAdaptivePlan(revised)).not.toBe(hashAdaptivePlan(created));
  });

  it('rejects incomplete or ambiguous machine-readable plans', () => {
    const service = new AdaptivePlanService();
    expect(() => service.create({ ...draft, deliverables: [] })).toThrow('invalid_plan_scope');
    expect(() =>
      service.create({
        ...draft,
        steps: [{ ...draft.steps[0]!, maxAttempts: 0 }],
      }),
    ).toThrow('invalid_plan_step');
  });
});

describe('DryRunService', () => {
  it('sorts channels by reliability and invalidates stale context', () => {
    const service = new DryRunService();
    expect(service.preview(plan, 'context-a')).toMatchObject({
      valid: true,
      invalidReasons: [],
      applications: ['fixture'],
      approvalStrategyIds: ['vision'],
      steps: [{ channels: ['UIA', 'VISION_INPUT'], maximumRisk: 'MEDIUM' }],
    });
    expect(service.preview(plan, 'context-b')).toMatchObject({
      valid: false,
      invalidReasons: ['STALE_CONTEXT'],
    });
  });
});

describe('AdaptiveComputerUseRunner', () => {
  it('uses the structured channel first and requires verified output', async () => {
    const uia = {
      execute: vi.fn(async () => ({
        verified: true,
        evidence: ['uia:ok'],
        contextFingerprint: 'context-a',
      })),
    };
    const vision = {
      execute: vi.fn(async () => ({
        verified: true,
        evidence: ['vision:ok'],
        contextFingerprint: 'context-a',
      })),
    };
    const runner = new AdaptiveComputerUseRunner(
      { UIA: uia, VISION_INPUT: vision },
      vi.fn(async () => undefined),
    );
    const result = await runner.run({
      missionId: 'mission-1',
      plan,
      currentContextFingerprint: 'context-a',
      approvedStrategyIds: new Set(),
    });
    expect(result.evidence).toEqual(['uia:ok']);
    expect(result.modelTokens).toBe(0);
    expect(uia.execute).toHaveBeenCalledOnce();
    expect(vision.execute).not.toHaveBeenCalled();
  });

  it('blocks and requires replan when context changes', async () => {
    const runner = new AdaptiveComputerUseRunner(
      {
        UIA: {
          execute: vi.fn(async () => ({
            verified: true,
            evidence: [],
            contextFingerprint: 'changed',
          })),
        },
      },
      vi.fn(async () => undefined),
    );
    await expect(
      runner.run({
        missionId: 'mission-1',
        plan,
        currentContextFingerprint: 'context-a',
        approvedStrategyIds: new Set(),
      }),
    ).rejects.toThrow('context_changed_requires_replan');
  });

  it('retries transient failures with bounded backoff and reports budgets', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new AdaptiveStrategyError('TRANSIENT', 'window_busy'))
      .mockResolvedValueOnce({
        verified: true,
        evidence: ['uia:retry-ok'],
        contextFingerprint: 'context-a',
      });
    const sleep = vi.fn(async () => undefined);
    const events = vi.fn(async () => undefined);
    const runner = new AdaptiveComputerUseRunner({ UIA: { execute } }, events, undefined, sleep);
    const result = await runner.run({
      missionId: 'mission-1',
      plan,
      currentContextFingerprint: 'context-a',
      approvedStrategyIds: new Set(),
      budget: { maxActions: 2, maxRetries: 1, maxWallClockMs: 1_000, baseBackoffMs: 10 },
    });
    expect(result).toMatchObject({ actions: 2, retries: 1, evidence: ['uia:retry-ok'] });
    expect(sleep).toHaveBeenCalledWith(10, expect.any(AbortSignal));
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: 'STRATEGY_RETRY' }));
  });

  it('never replays an action with an unknown result', async () => {
    const execute = vi.fn(async () => {
      throw new AdaptiveStrategyError('UNKNOWN_RESULT', 'connection_lost_after_send');
    });
    const runner = new AdaptiveComputerUseRunner(
      { UIA: { execute } },
      vi.fn(async () => undefined),
    );
    await expect(
      runner.run({
        missionId: 'mission-1',
        plan,
        currentContextFingerprint: 'context-a',
        approvedStrategyIds: new Set(),
      }),
    ).rejects.toThrow('unknown_action_result_requires_user');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('observes before acting and suspends on concurrent user activity', async () => {
    const execute = vi.fn();
    const runner = new AdaptiveComputerUseRunner(
      { UIA: { execute } },
      vi.fn(async () => undefined),
      {
        observe: vi.fn(async () => ({
          contextFingerprint: 'context-a',
          userActivityDetected: true,
        })),
      },
    );
    await expect(
      runner.run({
        missionId: 'mission-1',
        plan,
        currentContextFingerprint: 'context-a',
        approvedStrategyIds: new Set(),
      }),
    ).rejects.toThrow('user_activity_detected');
    expect(execute).not.toHaveBeenCalled();
  });

  it('enforces model consumption and never falls back to a less safe channel', async () => {
    const uia = vi.fn(async () => {
      throw new AdaptiveStrategyError('PERMANENT', 'selector_missing');
    });
    const vision = vi.fn(async () => ({
      verified: true,
      evidence: ['vision:ok'],
      contextFingerprint: 'context-a',
      modelTokens: 10,
    }));
    const runner = new AdaptiveComputerUseRunner(
      { UIA: { execute: uia }, VISION_INPUT: { execute: vision } },
      vi.fn(async () => undefined),
    );
    await expect(
      runner.run({
        missionId: 'mission-1',
        plan,
        currentContextFingerprint: 'context-a',
        approvedStrategyIds: new Set(['vision']),
      }),
    ).rejects.toThrow('required_step_failed');
    expect(vision).not.toHaveBeenCalled();

    const modelPlan: AdaptivePlan = {
      ...plan,
      steps: [{ ...plan.steps[0]!, strategies: [plan.steps[0]!.strategies[1]!] }],
    };
    const modelRunner = new AdaptiveComputerUseRunner(
      {
        UIA: {
          execute: vi.fn(async () => ({
            verified: true,
            evidence: ['uia:ok'],
            contextFingerprint: 'context-a',
            modelTokens: 11,
          })),
        },
      },
      vi.fn(async () => undefined),
    );
    await expect(
      modelRunner.run({
        missionId: 'mission-1',
        plan: modelPlan,
        currentContextFingerprint: 'context-a',
        approvedStrategyIds: new Set(),
        budget: {
          maxActions: 1,
          maxRetries: 0,
          maxWallClockMs: 1_000,
          baseBackoffMs: 10,
          maxModelTokens: 10,
        },
      }),
    ).rejects.toThrow('model_budget_exhausted');
  });
});

describe('HumanTakeoverController', () => {
  it('revalidates the context changed during takeover', () => {
    const controller = new HumanTakeoverController();
    controller.takeover({ id: 'checkpoint-1', contextFingerprint: 'before' });
    expect(controller.continue('after')).toBe('REVALIDATION_REQUIRED');
    expect(controller.current()).toBe('RECOVERING');
    controller.completeRecovery({ id: 'checkpoint-2', contextFingerprint: 'after' });
    expect(controller.current()).toBe('AUTOMATION');
  });

  it('suspends Focus Mode on user activity and restores it after exact revalidation', () => {
    const controller = new HumanTakeoverController();
    controller.enterFocus({ id: 'focus-start', contextFingerprint: 'context-a' });
    expect(controller.current()).toBe('FOCUS');
    controller.pauseForUserActivity({ id: 'user-active', contextFingerprint: 'context-a' });
    expect(controller.current()).toBe('PAUSED_USER_ACTIVITY');
    expect(controller.continue('context-a')).toBe('RESUMED');
    expect(controller.current()).toBe('FOCUS');
    controller.exitFocus();
    expect(controller.current()).toBe('AUTOMATION');
  });
});
