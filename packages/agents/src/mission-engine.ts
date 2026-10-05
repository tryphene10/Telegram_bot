import { createHash } from 'node:crypto';
import { MissionRuntimeError, validateMissionPlan } from './mission-runtime.js';
import type {
  InMemoryDurableMissionStore,
  ActionReceipt,
  MissionAggregate,
  MissionDefinition,
  MissionStep,
  MissionStepPlan,
} from './mission-runtime.js';

export interface DeterministicPlanner {
  plan(mission: MissionAggregate): Promise<readonly MissionStepPlan[]>;
}

export type StepOutcome =
  | { readonly status: 'COMPLETED'; readonly result: Readonly<Record<string, unknown>> }
  | { readonly status: 'WAITING_APPROVAL'; readonly approvalId: string }
  | { readonly status: 'BLOCKED'; readonly cause: string; readonly expectedAction: string }
  | { readonly status: 'FAILED'; readonly error: string; readonly retryable: boolean };

export interface DeterministicStepExecutor {
  execute(input: {
    readonly mission: MissionAggregate;
    readonly step: MissionStep;
    readonly idempotencyKey: string;
    readonly actionHash: string;
    readonly signal: AbortSignal;
  }): Promise<StepOutcome>;
}

export interface ObjectiveVerifier {
  verify(mission: MissionAggregate): Promise<{
    readonly passed: boolean;
    readonly evidence: readonly string[];
    readonly remainingRisks: readonly string[];
    readonly verifiedFacts?: readonly string[];
    readonly hypotheses?: readonly string[];
  }>;
}

function actionHash(mission: MissionAggregate, step: MissionStep): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        mission: mission.id,
        definitionHash: mission.definitionHash,
        step: step.id,
        attempt: step.attempts,
        loop: step.loops,
      }),
    )
    .digest('hex');
}

function replaceStep(
  mission: MissionAggregate,
  stepId: string,
  mutate: (step: MissionStep) => MissionStep,
): readonly MissionStep[] {
  return mission.plan.map((step) => (step.id === stepId ? mutate(step) : step));
}

function preliminaryReport(
  mission: MissionAggregate,
  evidence: readonly string[],
  risks: readonly string[],
  verifiedFacts: readonly string[],
  hypotheses: readonly string[],
): string {
  return JSON.stringify({
    missionId: mission.id,
    objective: mission.definition.objective,
    completedSteps: mission.plan.filter(({ status }) => status === 'COMPLETED').map(({ id }) => id),
    verifiedFacts,
    hypotheses,
    actions: mission.plan
      .filter(({ status }) => status === 'COMPLETED')
      .map(({ id, title, agentKey }) => ({ id, title, agentKey: agentKey ?? 'UNASSIGNED' })),
    evidence,
    remainingRisks: risks,
    timelineEvents: mission.timeline.length + 1,
  });
}

export class DeterministicMissionEngine {
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly store: InMemoryDurableMissionStore,
    private readonly planner: DeterministicPlanner,
    private readonly executor: DeterministicStepExecutor,
    private readonly verifier: ObjectiveVerifier,
    private readonly leaseMs = 60_000,
  ) {}

  submit(definition: MissionDefinition): MissionAggregate {
    return this.store.create(definition);
  }

  async runNext(worker: string): Promise<MissionAggregate | null> {
    let mission = this.store.claimNext(worker, this.leaseMs);
    if (!mission) return null;
    const missionId = mission.id;
    const controller = new AbortController();
    this.active.set(missionId, controller);
    const heartbeat = setInterval(
      () => {
        try {
          this.store.renewLease(missionId, worker, this.leaseMs);
        } catch {
          controller.abort();
        }
      },
      Math.max(10, Math.floor(this.leaseMs / 2)),
    );
    heartbeat.unref?.();
    try {
      if (mission.plan.length === 0) {
        const plan = validateMissionPlan(await this.planner.plan(mission));
        mission = this.store.save(mission, { plan, status: 'RUNNING' }, 'MISSION_PLANNED', {
          steps: plan.length,
        });
      } else {
        mission = this.store.save(mission, { status: 'RUNNING' }, 'MISSION_RESUMED');
      }

      for (;;) {
        const currentPlan = mission.plan;
        const next = currentPlan.find(
          (step) =>
            ['PENDING', 'RUNNING', 'FAILED', 'WAITING_APPROVAL', 'BLOCKED'].includes(step.status) &&
            step.dependencies.every(
              (dependency) =>
                currentPlan.find(({ id }) => id === dependency)?.status === 'COMPLETED',
            ),
        );
        if (!next) {
          if (mission.plan.every(({ status }) => ['COMPLETED', 'SKIPPED'].includes(status))) {
            return await this.verify(mission);
          }
          return this.block(mission, 'no_executable_step', 'Corriger les dependances du plan');
        }
        if (next.attempts >= next.maxAttempts || next.loops >= next.maxLoops) {
          return this.block(
            mission,
            'step_limits_exhausted',
            `Reviser l'etape ${next.id} ou augmenter explicitement ses limites`,
          );
        }
        let started: MissionStep;
        let outcome: StepOutcome;
        if (next.status === 'RUNNING' && next.activeActionKey && next.activeActionHash) {
          started = next;
          const receipt = this.store.receipt(next.activeActionKey);
          if (!receipt) {
            return this.block(
              mission,
              'action_outcome_unknown_after_restart',
              `Verifier manuellement l'action ${next.activeActionKey} avant reprise`,
              next.id,
            );
          }
          if (receipt.actionHash !== next.activeActionHash) {
            throw new MissionRuntimeError('action_idempotency_conflict');
          }
          outcome = { status: 'COMPLETED', result: receipt.result };
        } else {
          const pending = {
            ...next,
            status: 'RUNNING' as const,
            attempts: next.attempts + 1,
            loops: next.loops + 1,
          };
          const hash = actionHash(mission, pending);
          const idempotencyKey = `${mission.id}:${pending.id}:${pending.attempts}:${hash}`;
          started = { ...pending, activeActionKey: idempotencyKey, activeActionHash: hash };
          mission = this.store.save(
            mission,
            { plan: replaceStep(mission, next.id, () => started) },
            'STEP_STARTED',
            { step: next.id, attempt: started.attempts },
          );
          outcome = await this.executor.execute({
            mission,
            step: started,
            idempotencyKey,
            actionHash: hash,
            signal: controller.signal,
          });
          if (outcome.status === 'COMPLETED') {
            const completedReceipt: ActionReceipt = {
              key: idempotencyKey,
              actionHash: hash,
              result: outcome.result,
            };
            this.store.completeAction(completedReceipt);
          }
        }
        if (outcome.status === 'COMPLETED') {
          mission = this.store.save(
            mission,
            {
              plan: replaceStep(mission, started.id, (step) => ({
                ...step,
                status: 'COMPLETED',
                result: outcome.result,
                activeActionKey: undefined,
                activeActionHash: undefined,
              })),
            },
            'STEP_COMPLETED',
            { step: started.id },
          );
          continue;
        }
        if (outcome.status === 'WAITING_APPROVAL') {
          mission = this.store.save(
            mission,
            {
              status: 'WAITING_APPROVAL',
              plan: replaceStep(mission, started.id, (step) => ({
                ...step,
                status: 'WAITING_APPROVAL',
              })),
            },
            'MISSION_WAITING_APPROVAL',
            { step: started.id, approvalId: outcome.approvalId },
          );
          return mission;
        }
        if (outcome.status === 'BLOCKED') {
          return this.block(mission, outcome.cause, outcome.expectedAction, started.id);
        }
        if (outcome.retryable && started.attempts < started.maxAttempts) {
          mission = this.store.save(
            mission,
            {
              plan: replaceStep(mission, started.id, (step) => ({
                ...step,
                status: 'FAILED',
                error: outcome.error,
              })),
            },
            'STEP_RETRY_SCHEDULED',
            { step: started.id },
          );
          continue;
        }
        mission = this.store.save(
          mission,
          {
            status: 'FAILED',
            plan: replaceStep(mission, started.id, (step) => ({
              ...step,
              status: 'FAILED',
              error: outcome.error,
            })),
          },
          'MISSION_FAILED',
          { step: started.id },
        );
        return mission;
      }
    } finally {
      clearInterval(heartbeat);
      this.active.delete(missionId);
      this.store.release(mission);
    }
  }

  pause(id: string): MissionAggregate {
    const mission = this.store.get(id);
    if (
      !['QUEUED', 'PLANNING', 'RUNNING', 'VERIFYING', 'WAITING_APPROVAL', 'BLOCKED'].includes(
        mission.status,
      )
    ) {
      throw new MissionRuntimeError('mission_not_pausable');
    }
    this.active.get(id)?.abort();
    const paused = this.store.save(mission, { status: 'PAUSED' }, 'MISSION_PAUSED');
    this.store.release(paused);
    return paused;
  }

  resume(id: string): MissionAggregate {
    const mission = this.store.get(id);
    if (!['PAUSED', 'BLOCKED', 'FAILED', 'WAITING_APPROVAL'].includes(mission.status)) {
      throw new MissionRuntimeError('mission_not_resumable');
    }
    return this.store.save(mission, { status: 'QUEUED', blocked: undefined }, 'MISSION_REQUEUED');
  }

  cancel(id: string): MissionAggregate {
    const mission = this.store.get(id);
    if (mission.status === 'CANCELLED') return mission;
    if (mission.status === 'COMPLETED')
      throw new MissionRuntimeError('completed_mission_not_cancellable');
    this.active.get(id)?.abort();
    const cancelled = this.store.save(
      mission,
      {
        status: 'CANCELLED',
        plan: mission.plan.map((step) =>
          ['COMPLETED', 'SKIPPED'].includes(step.status)
            ? step
            : { ...step, status: 'CANCELLED' as const },
        ),
      },
      'MISSION_CANCELLED',
    );
    this.store.release(cancelled);
    return cancelled;
  }

  private block(
    mission: MissionAggregate,
    cause: string,
    expectedAction: string,
    stepId?: string,
  ): MissionAggregate {
    return this.store.save(
      mission,
      {
        status: 'BLOCKED',
        blocked: { cause, expectedAction },
        ...(stepId
          ? {
              plan: replaceStep(mission, stepId, (step) => ({ ...step, status: 'BLOCKED' })),
            }
          : {}),
      },
      'MISSION_BLOCKED',
      { cause, expectedAction },
    );
  }

  private async verify(mission: MissionAggregate): Promise<MissionAggregate> {
    mission = this.store.save(mission, { status: 'VERIFYING' }, 'MISSION_VERIFYING');
    const verification = await this.verifier.verify(mission);
    if (!verification.passed || verification.evidence.length === 0) {
      return this.block(
        mission,
        'objective_verification_failed',
        'Fournir une verification objective reussie',
      );
    }
    return this.store.save(
      mission,
      {
        status: 'COMPLETED',
        verificationEvidence: [...verification.evidence],
        finalReport: preliminaryReport(
          mission,
          verification.evidence,
          verification.remainingRisks,
          verification.verifiedFacts ?? [],
          verification.hypotheses ?? [],
        ),
      },
      'MISSION_COMPLETED',
      { evidenceCount: verification.evidence.length },
    );
  }
}
