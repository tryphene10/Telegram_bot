import { AdaptiveRunError, type AdaptivePlan } from './adaptive-computer-use.js';
import type { AdaptiveComputerUseRunner } from './adaptive-computer-use.js';

export interface AdaptivePlanLoadPort {
  load(missionId: string, adaptivePlanId: string): Promise<AdaptivePlan | undefined>;
}

export interface AdaptiveExecutionContextPort {
  currentFingerprint(missionId: string): Promise<string>;
  approvedStrategyIds(missionId: string, adaptivePlanId: string): Promise<ReadonlySet<string>>;
}

export interface AdaptiveCheckpointPort {
  save(input: {
    readonly missionId: string;
    readonly adaptivePlanId: string;
    readonly checkpointId: string;
    readonly contextFingerprint: string;
    readonly completedStepIds: readonly string[];
    readonly evidence: readonly string[];
    readonly actions: number;
    readonly retries: number;
    readonly modelTokens: number;
    readonly createdAt: string;
  }): Promise<void>;
}

export type AdaptiveMissionAdapterOutcome =
  | Readonly<{
      status: 'COMPLETED';
      evidence: readonly string[];
      completedStepIds: readonly string[];
      actions: number;
      retries: number;
      checkpointId: string;
    }>
  | Readonly<{
      status: 'BLOCKED';
      cause:
        | 'STALE_CONTEXT'
        | 'USER_ACTIVITY'
        | 'UNKNOWN_RESULT'
        | 'EMERGENCY_STOP'
        | 'NO_VERIFIED_STRATEGY';
      detail?: string;
    }>
  | Readonly<{ status: 'FAILED'; error: string; retryable: boolean }>;

function blocked(error: AdaptiveRunError): AdaptiveMissionAdapterOutcome {
  if (error.reason === 'stale_plan_context' || error.reason === 'context_changed_requires_replan') {
    return { status: 'BLOCKED', cause: 'STALE_CONTEXT' };
  }
  if (error.reason === 'user_activity_detected') {
    return { status: 'BLOCKED', cause: 'USER_ACTIVITY' };
  }
  if (error.reason === 'unknown_action_result_requires_user') {
    return { status: 'BLOCKED', cause: 'UNKNOWN_RESULT' };
  }
  if (error.reason === 'emergency_stop_active' || error.reason === 'run_aborted') {
    return { status: 'BLOCKED', cause: 'EMERGENCY_STOP' };
  }
  if (error.reason.startsWith('required_step_failed:')) {
    return { status: 'BLOCKED', cause: 'NO_VERIFIED_STRATEGY', detail: error.reason };
  }
  return { status: 'FAILED', error: error.reason, retryable: false };
}

export class AdaptiveDesktopMissionAdapter {
  private checkpointSequence = 0;

  constructor(
    private readonly plans: AdaptivePlanLoadPort,
    private readonly context: AdaptiveExecutionContextPort,
    private readonly runner: AdaptiveComputerUseRunner,
    private readonly checkpoints: AdaptiveCheckpointPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: {
    readonly missionId: string;
    readonly adaptivePlanId: string;
    readonly idempotencyKey: string;
    readonly actionHash: string;
    readonly signal: AbortSignal;
  }): Promise<AdaptiveMissionAdapterOutcome> {
    const plan = await this.plans.load(input.missionId, input.adaptivePlanId);
    if (!plan || plan.id !== input.adaptivePlanId) {
      return {
        status: 'BLOCKED',
        cause: 'NO_VERIFIED_STRATEGY',
        detail: 'adaptive_plan_not_found_or_mismatched',
      };
    }
    const currentContextFingerprint = await this.context.currentFingerprint(input.missionId);
    const approvedStrategyIds = await this.context.approvedStrategyIds(
      input.missionId,
      input.adaptivePlanId,
    );
    try {
      const result = await this.runner.run({
        missionId: input.missionId,
        plan,
        currentContextFingerprint,
        approvedStrategyIds,
        signal: input.signal,
      });
      const checkpointId = `${input.adaptivePlanId}-${plan.revision}-${++this.checkpointSequence}`;
      await this.checkpoints.save({
        missionId: input.missionId,
        adaptivePlanId: input.adaptivePlanId,
        checkpointId,
        contextFingerprint: currentContextFingerprint,
        completedStepIds: result.completedSteps,
        evidence: result.evidence,
        actions: result.actions,
        retries: result.retries,
        modelTokens: result.modelTokens,
        createdAt: this.now().toISOString(),
      });
      return {
        status: 'COMPLETED',
        evidence: result.evidence,
        completedStepIds: result.completedSteps,
        actions: result.actions,
        retries: result.retries,
        checkpointId,
      };
    } catch (error) {
      if (error instanceof AdaptiveRunError) return blocked(error);
      return {
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'unknown_adaptive_error',
        retryable: false,
      };
    }
  }
}
