import assert from 'node:assert/strict';
import { stdout } from 'node:process';
import {
  AdaptiveComputerUseRunner,
  AdaptiveDesktopMissionAdapter,
  ComputerUseProofCollector,
  DryRunService,
  hashAdaptivePlan,
} from '../apps/desktop-agent/dist/index.js';
import {
  AdaptiveMissionStepExecutor,
  DeterministicMissionEngine,
  InMemoryDurableMissionStore,
} from '../packages/agents/dist/index.js';

const plan = {
  id: 'desktop-plan-1',
  revision: 1,
  contextFingerprint: 'window-fixture-v1',
  objective: 'Configure and save the fixture',
  constraints: ['Structured automation only'],
  deliverables: ['Verified saved configuration'],
  assumptions: ['Fixture is open'],
  missingInformation: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  steps: [
    {
      id: 'configure',
      title: 'Configure the value',
      required: true,
      maxAttempts: 2,
      strategies: [{ id: 'uia-configure', channel: 'UIA', risk: 'LOW', requiresApproval: false }],
      successCriterion: 'value visible',
      applications: ['fixture'],
      files: [],
    },
    {
      id: 'save',
      title: 'Save the value',
      required: true,
      maxAttempts: 2,
      strategies: [{ id: 'uia-save', channel: 'UIA', risk: 'LOW', requiresApproval: false }],
      successCriterion: 'saved confirmation visible',
      applications: ['fixture'],
      files: [],
    },
  ],
};

const dryRun = new DryRunService().preview(plan, 'window-fixture-v1');
assert.equal(dryRun.valid, true);
assert.equal(new DryRunService().preview(plan, 'window-fixture-v2').valid, false);

const checkpoints = [];
const runner = new AdaptiveComputerUseRunner(
  {
    UIA: {
      execute: async ({ step }) => ({
        verified: true,
        evidence: [`audit:${step.id}`],
        contextFingerprint: 'window-fixture-v1',
        modelTokens: 0,
      }),
    },
  },
  async () => undefined,
);
const adapter = new AdaptiveDesktopMissionAdapter(
  { load: async (_missionId, planId) => (planId === plan.id ? plan : undefined) },
  {
    currentFingerprint: async () => 'window-fixture-v1',
    approvedStrategyIds: async () => new Set(),
  },
  runner,
  { save: async (checkpoint) => checkpoints.push(checkpoint) },
  () => new Date('2026-10-01T00:00:01.000Z'),
);

const store = new InMemoryDurableMissionStore();
const engine = new DeterministicMissionEngine(
  store,
  {
    plan: async () => [
      {
        id: 'desktop',
        title: 'Execute adaptive desktop plan',
        dependencies: [],
        maxAttempts: 2,
        maxLoops: 2,
        exitCriteria: ['desktop plan verified'],
        executionKind: 'ADAPTIVE_DESKTOP',
        adaptivePlanId: plan.id,
      },
    ],
  },
  new AdaptiveMissionStepExecutor(adapter),
  {
    verify: async (mission) => {
      const result = mission.plan[0]?.result;
      const evidence = Array.isArray(result?.evidence) ? result.evidence : [];
      const proof = new ComputerUseProofCollector(mission.id, {
        id: plan.id,
        revision: plan.revision,
        hash: hashAdaptivePlan(plan),
        requiredStepIds: plan.steps.filter(({ required }) => required).map(({ id }) => id),
      });
      for (const step of plan.steps) {
        proof.recordVerifiedStep({
          stepId: step.id,
          criterion: step.successCriterion,
          evidenceReferences: evidence.filter((reference) => reference === `audit:${step.id}`),
        });
      }
      proof.recordExecution(Number(result?.actions ?? 0), Number(result?.retries ?? 0));
      const report = proof.finalize();
      return {
        passed: report.status === 'VERIFIED',
        evidence: [`proof:${report.digest}`],
        remainingRisks: report.remainingRisks,
      };
    },
  },
);

engine.submit({
  idempotencyKey: 'telegram:adaptive:0001',
  projectId: 'project-1',
  objective: plan.objective,
  context: {},
  successCriteria: ['both desktop steps verified'],
  definitionOfDone: ['proof digest generated'],
});
const completed = await engine.runNext('adaptive-worker');
assert.equal(completed?.status, 'COMPLETED');
assert.equal(checkpoints.length, 1);
assert.deepEqual(checkpoints[0].completedStepIds, ['configure', 'save']);
assert.match(completed.verificationEvidence[0], /^proof:[a-f0-9]{64}$/u);

stdout.write(
  JSON.stringify({
    missionStatus: completed.status,
    adaptiveSteps: checkpoints[0].completedStepIds.length,
    evidence: completed.verificationEvidence.length,
    checkpoint: checkpoints[0].checkpointId,
    dryRunStaleDetection: true,
  }) + '\n',
);
