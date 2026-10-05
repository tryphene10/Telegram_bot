import { describe, expect, it, vi } from 'vitest';
import { AdaptiveComputerUseRunner, type AdaptivePlan } from './adaptive-computer-use.js';
import { AdaptiveDesktopMissionAdapter } from './adaptive-mission-adapter.js';

const plan: AdaptivePlan = {
  id: 'plan-1',
  revision: 1,
  contextFingerprint: 'context-a',
  objective: 'Save a setting',
  constraints: ['Use UIA'],
  deliverables: ['Saved setting'],
  assumptions: [],
  missingInformation: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  steps: [
    {
      id: 'save',
      title: 'Save',
      required: true,
      maxAttempts: 1,
      strategies: [{ id: 'uia-save', channel: 'UIA', risk: 'LOW', requiresApproval: false }],
      successCriterion: 'saved',
      applications: ['fixture'],
      files: [],
    },
  ],
};

function input() {
  return {
    missionId: 'mission-1',
    adaptivePlanId: 'plan-1',
    idempotencyKey: 'mission-1:desktop:1',
    actionHash: 'a'.repeat(64),
    signal: new AbortController().signal,
  };
}

describe('AdaptiveDesktopMissionAdapter', () => {
  it('loads the exact plan and persists a verified checkpoint', async () => {
    const save = vi.fn(async () => undefined);
    const runner = new AdaptiveComputerUseRunner(
      {
        UIA: {
          execute: vi.fn(async () => ({
            verified: true,
            evidence: ['audit:save-1'],
            contextFingerprint: 'context-a',
            modelTokens: 4,
          })),
        },
      },
      vi.fn(async () => undefined),
    );
    const adapter = new AdaptiveDesktopMissionAdapter(
      { load: vi.fn(async () => plan) },
      {
        currentFingerprint: vi.fn(async () => 'context-a'),
        approvedStrategyIds: vi.fn(async () => new Set<string>()),
      },
      runner,
      { save },
      () => new Date('2026-10-01T00:00:01.000Z'),
    );
    await expect(adapter.execute(input())).resolves.toMatchObject({
      status: 'COMPLETED',
      evidence: ['audit:save-1'],
      checkpointId: 'plan-1-1-1',
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        contextFingerprint: 'context-a',
        completedStepIds: ['save'],
        modelTokens: 4,
      }),
    );
  });

  it('blocks on stale context before any action or checkpoint', async () => {
    const execute = vi.fn();
    const save = vi.fn();
    const adapter = new AdaptiveDesktopMissionAdapter(
      { load: vi.fn(async () => plan) },
      {
        currentFingerprint: vi.fn(async () => 'context-b'),
        approvedStrategyIds: vi.fn(async () => new Set<string>()),
      },
      new AdaptiveComputerUseRunner(
        { UIA: { execute } },
        vi.fn(async () => undefined),
      ),
      { save },
    );
    await expect(adapter.execute(input())).resolves.toEqual({
      status: 'BLOCKED',
      cause: 'STALE_CONTEXT',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
