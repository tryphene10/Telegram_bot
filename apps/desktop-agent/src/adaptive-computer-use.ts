import { createHash, randomUUID } from 'node:crypto';
import type { ComputerUseChannel, ComputerUseRisk } from './computer-use-core.js';

const CHANNEL_ORDER: Readonly<Record<ComputerUseChannel, number>> = {
  CONNECTOR: 1,
  CLI: 2,
  UIA: 3,
  BROWSER: 4,
  VISION_INPUT: 5,
};

const RISK_RANK: Readonly<Record<ComputerUseRisk, number>> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export interface PlannedStrategy {
  readonly id: string;
  readonly channel: ComputerUseChannel;
  readonly risk: ComputerUseRisk;
  readonly requiresApproval: boolean;
}

export interface AdaptivePlanStep {
  readonly id: string;
  readonly title: string;
  readonly required: boolean;
  readonly maxAttempts: number;
  readonly strategies: readonly PlannedStrategy[];
  readonly successCriterion: string;
  readonly applications: readonly string[];
  readonly files: readonly string[];
}

export interface AdaptivePlan {
  readonly id: string;
  readonly revision: number;
  readonly contextFingerprint: string;
  readonly objective: string;
  readonly constraints: readonly string[];
  readonly deliverables: readonly string[];
  readonly assumptions: readonly string[];
  readonly missingInformation: readonly string[];
  readonly steps: readonly AdaptivePlanStep[];
  readonly createdAt: string;
}

export type AdaptivePlanDraft = Omit<AdaptivePlan, 'id' | 'revision' | 'createdAt'>;

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function uniqueNonEmpty(values: readonly string[]): boolean {
  return values.every(nonEmpty) && new Set(values).size === values.length;
}

export function hashAdaptivePlan(plan: AdaptivePlan): string {
  return createHash('sha256').update(JSON.stringify(plan), 'utf8').digest('hex');
}

export class AdaptivePlanService {
  constructor(
    private readonly createId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(draft: AdaptivePlanDraft): AdaptivePlan {
    this.validate(draft);
    return {
      ...draft,
      id: this.createId(),
      revision: 1,
      createdAt: this.now().toISOString(),
    };
  }

  revise(plan: AdaptivePlan, draft: AdaptivePlanDraft): AdaptivePlan {
    this.validate(draft);
    return {
      ...draft,
      id: plan.id,
      revision: plan.revision + 1,
      createdAt: this.now().toISOString(),
    };
  }

  private validate(draft: AdaptivePlanDraft): void {
    if (!nonEmpty(draft.contextFingerprint) || !nonEmpty(draft.objective)) {
      throw new AdaptiveRunError('invalid_plan_identity');
    }
    if (
      !uniqueNonEmpty(draft.constraints) ||
      !uniqueNonEmpty(draft.deliverables) ||
      !uniqueNonEmpty(draft.assumptions) ||
      !uniqueNonEmpty(draft.missingInformation) ||
      draft.deliverables.length === 0 ||
      draft.steps.length === 0
    ) {
      throw new AdaptiveRunError('invalid_plan_scope');
    }
    const stepIds = new Set<string>();
    const strategyIds = new Set<string>();
    for (const step of draft.steps) {
      if (
        !nonEmpty(step.id) ||
        !nonEmpty(step.title) ||
        !nonEmpty(step.successCriterion) ||
        stepIds.has(step.id) ||
        !Number.isSafeInteger(step.maxAttempts) ||
        step.maxAttempts < 1 ||
        step.maxAttempts > 10 ||
        step.strategies.length === 0 ||
        !uniqueNonEmpty(step.applications) ||
        !uniqueNonEmpty(step.files)
      ) {
        throw new AdaptiveRunError('invalid_plan_step');
      }
      stepIds.add(step.id);
      for (const strategy of step.strategies) {
        if (!nonEmpty(strategy.id) || strategyIds.has(strategy.id)) {
          throw new AdaptiveRunError('invalid_plan_strategy');
        }
        strategyIds.add(strategy.id);
      }
    }
  }
}

export interface StrategyExecutor {
  execute(input: {
    readonly missionId: string;
    readonly step: AdaptivePlanStep;
    readonly strategy: PlannedStrategy;
    readonly signal: AbortSignal;
    readonly remainingModelTokens: number;
  }): Promise<
    Readonly<{
      verified: boolean;
      evidence: readonly string[];
      contextFingerprint: string;
      modelTokens?: number;
    }>
  >;
}

export type AdaptiveFailureCategory = 'TRANSIENT' | 'UI_CHANGED' | 'PERMANENT' | 'UNKNOWN_RESULT';

export class AdaptiveStrategyError extends Error {
  constructor(
    readonly category: AdaptiveFailureCategory,
    readonly reason: string,
  ) {
    super(`Adaptive strategy failed: ${category}:${reason}`);
    this.name = 'AdaptiveStrategyError';
  }
}

export interface AdaptiveContextObserver {
  observe(input: {
    readonly missionId: string;
    readonly stepId: string;
    readonly signal: AbortSignal;
  }): Promise<Readonly<{ contextFingerprint: string; userActivityDetected: boolean }>>;
}

export interface AdaptiveRunEvent {
  readonly type:
    | 'STEP_STARTED'
    | 'STRATEGY_FAILED'
    | 'STRATEGY_RETRY'
    | 'STRATEGY_VERIFIED'
    | 'PLAN_BLOCKED'
    | 'USER_ACTIVITY_DETECTED';
  readonly stepId: string;
  readonly strategyId?: string;
  readonly reason?: string;
}

export class AdaptiveRunError extends Error {
  constructor(readonly reason: string) {
    super(`Adaptive run stopped: ${reason}`);
    this.name = 'AdaptiveRunError';
  }
}

export class DryRunService {
  preview(
    plan: AdaptivePlan,
    currentContextFingerprint: string,
  ): Readonly<{
    valid: boolean;
    invalidReasons: readonly ('STALE_CONTEXT' | 'MISSING_INFORMATION')[];
    planId: string;
    planHash: string;
    revision: number;
    objective: string;
    constraints: readonly string[];
    deliverables: readonly string[];
    assumptions: readonly string[];
    missingInformation: readonly string[];
    applications: readonly string[];
    files: readonly string[];
    approvalStrategyIds: readonly string[];
    steps: readonly Readonly<{
      id: string;
      title: string;
      channels: readonly ComputerUseChannel[];
      maximumRisk: ComputerUseRisk;
      approvalsRequired: number;
    }>[];
  }> {
    const risks: readonly ComputerUseRisk[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const invalidReasons: ('STALE_CONTEXT' | 'MISSING_INFORMATION')[] = [];
    if (plan.contextFingerprint !== currentContextFingerprint) invalidReasons.push('STALE_CONTEXT');
    if (plan.missingInformation.length > 0) invalidReasons.push('MISSING_INFORMATION');
    return {
      valid: invalidReasons.length === 0,
      invalidReasons,
      planId: plan.id,
      planHash: hashAdaptivePlan(plan),
      revision: plan.revision,
      objective: plan.objective,
      constraints: plan.constraints,
      deliverables: plan.deliverables,
      assumptions: plan.assumptions,
      missingInformation: plan.missingInformation,
      applications: [...new Set(plan.steps.flatMap(({ applications }) => applications))],
      files: [...new Set(plan.steps.flatMap(({ files }) => files))],
      approvalStrategyIds: plan.steps.flatMap(({ strategies }) =>
        strategies.filter(({ requiresApproval }) => requiresApproval).map(({ id }) => id),
      ),
      steps: plan.steps.map((step) => ({
        id: step.id,
        title: step.title,
        channels: [...step.strategies]
          .sort((left, right) => CHANNEL_ORDER[left.channel] - CHANNEL_ORDER[right.channel])
          .map(({ channel }) => channel),
        maximumRisk: risks.reduce<ComputerUseRisk>(
          (highest, risk) =>
            step.strategies.some((item) => RISK_RANK[item.risk] === RISK_RANK[risk]) &&
            RISK_RANK[risk] > RISK_RANK[highest]
              ? risk
              : highest,
          'LOW',
        ),
        approvalsRequired: step.strategies.filter(({ requiresApproval }) => requiresApproval)
          .length,
      })),
    };
  }
}

export class AdaptiveComputerUseRunner {
  constructor(
    private readonly executors: Readonly<Partial<Record<ComputerUseChannel, StrategyExecutor>>>,
    private readonly eventSink: (event: AdaptiveRunEvent) => Promise<void>,
    private readonly observer?: AdaptiveContextObserver,
    private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void> = (
      milliseconds,
      signal,
    ) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, milliseconds);
        timer.unref?.();
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new AdaptiveRunError('run_aborted'));
          },
          { once: true },
        );
      }),
    private readonly now: () => number = Date.now,
  ) {}

  async run(input: {
    readonly missionId: string;
    readonly plan: AdaptivePlan;
    readonly currentContextFingerprint: string;
    readonly approvedStrategyIds: ReadonlySet<string>;
    readonly signal?: AbortSignal;
    readonly budget?: Readonly<{
      maxActions: number;
      maxRetries: number;
      maxWallClockMs: number;
      baseBackoffMs: number;
      maxModelTokens?: number;
    }>;
  }): Promise<
    Readonly<{
      completedSteps: readonly string[];
      evidence: readonly string[];
      actions: number;
      retries: number;
      modelTokens: number;
    }>
  > {
    if (input.plan.contextFingerprint !== input.currentContextFingerprint) {
      throw new AdaptiveRunError('stale_plan_context');
    }
    const signal = input.signal ?? new AbortController().signal;
    const budget = input.budget ?? {
      maxActions: 100,
      maxRetries: 10,
      maxWallClockMs: 30 * 60_000,
      baseBackoffMs: 250,
      maxModelTokens: 100_000,
    };
    const maxModelTokens = budget.maxModelTokens ?? 100_000;
    if (
      !Number.isSafeInteger(budget.maxActions) ||
      budget.maxActions < 1 ||
      budget.maxActions > 1_000 ||
      !Number.isSafeInteger(budget.maxRetries) ||
      budget.maxRetries < 0 ||
      budget.maxRetries > 100 ||
      !Number.isSafeInteger(budget.maxWallClockMs) ||
      budget.maxWallClockMs < 1 ||
      budget.maxWallClockMs > 86_400_000 ||
      !Number.isSafeInteger(budget.baseBackoffMs) ||
      budget.baseBackoffMs < 1 ||
      budget.baseBackoffMs > 60_000 ||
      !Number.isSafeInteger(maxModelTokens) ||
      maxModelTokens < 0 ||
      maxModelTokens > 10_000_000
    ) {
      throw new AdaptiveRunError('invalid_run_budget');
    }
    const startedAt = this.now();
    let actions = 0;
    let retries = 0;
    let modelTokens = 0;
    const completedSteps: string[] = [];
    const evidence: string[] = [];
    for (const step of input.plan.steps) {
      if (signal.aborted) throw new AdaptiveRunError('run_aborted');
      await this.eventSink({ type: 'STEP_STARTED', stepId: step.id });
      const strategies = [...step.strategies].sort(
        (left, right) => CHANNEL_ORDER[left.channel] - CHANNEL_ORDER[right.channel],
      );
      let verified = false;
      let attempts = 0;
      let previousAttempted: PlannedStrategy | undefined;
      for (const strategy of strategies) {
        if (attempts >= step.maxAttempts) break;
        const isFallback = previousAttempted !== undefined;
        if (
          isFallback &&
          previousAttempted &&
          RISK_RANK[strategy.risk] > RISK_RANK[previousAttempted.risk]
        ) {
          continue;
        }
        if (
          (strategy.requiresApproval || previousAttempted?.requiresApproval === true) &&
          !input.approvedStrategyIds.has(strategy.id)
        ) {
          continue;
        }
        const executor = this.executors[strategy.channel];
        if (!executor) continue;
        for (;;) {
          if (attempts >= step.maxAttempts) break;
          if (actions >= budget.maxActions || this.now() - startedAt >= budget.maxWallClockMs) {
            throw new AdaptiveRunError('run_budget_exhausted');
          }
          if (signal.aborted) throw new AdaptiveRunError('run_aborted');
          if (this.observer) {
            const observation = await this.observer.observe({
              missionId: input.missionId,
              stepId: step.id,
              signal,
            });
            if (observation.userActivityDetected) {
              await this.eventSink({
                type: 'USER_ACTIVITY_DETECTED',
                stepId: step.id,
                strategyId: strategy.id,
              });
              throw new AdaptiveRunError('user_activity_detected');
            }
            if (observation.contextFingerprint !== input.plan.contextFingerprint) {
              await this.eventSink({
                type: 'PLAN_BLOCKED',
                stepId: step.id,
                strategyId: strategy.id,
                reason: 'context_changed_before_action',
              });
              throw new AdaptiveRunError('context_changed_requires_replan');
            }
          }
          attempts += 1;
          actions += 1;
          previousAttempted = strategy;
          try {
            const result = await executor.execute({
              missionId: input.missionId,
              step,
              strategy,
              signal,
              remainingModelTokens: maxModelTokens - modelTokens,
            });
            const consumed = result.modelTokens ?? 0;
            if (!Number.isSafeInteger(consumed) || consumed < 0) {
              throw new AdaptiveStrategyError('PERMANENT', 'invalid_model_consumption');
            }
            modelTokens += consumed;
            if (modelTokens > maxModelTokens) throw new AdaptiveRunError('model_budget_exhausted');
            if (result.contextFingerprint !== input.plan.contextFingerprint) {
              await this.eventSink({
                type: 'PLAN_BLOCKED',
                stepId: step.id,
                strategyId: strategy.id,
                reason: 'context_changed',
              });
              throw new AdaptiveRunError('context_changed_requires_replan');
            }
            if (!result.verified)
              throw new AdaptiveStrategyError('PERMANENT', 'verification_failed');
            evidence.push(...result.evidence);
            completedSteps.push(step.id);
            verified = true;
            await this.eventSink({
              type: 'STRATEGY_VERIFIED',
              stepId: step.id,
              strategyId: strategy.id,
            });
            break;
          } catch (error) {
            if (error instanceof AdaptiveRunError) throw error;
            if (error instanceof AdaptiveStrategyError && error.category === 'UNKNOWN_RESULT') {
              await this.eventSink({
                type: 'PLAN_BLOCKED',
                stepId: step.id,
                strategyId: strategy.id,
                reason: `unknown_result:${error.reason}`,
              });
              throw new AdaptiveRunError('unknown_action_result_requires_user');
            }
            if (error instanceof AdaptiveStrategyError && error.category === 'UI_CHANGED') {
              throw new AdaptiveRunError('context_changed_requires_replan');
            }
            await this.eventSink({
              type: 'STRATEGY_FAILED',
              stepId: step.id,
              strategyId: strategy.id,
              reason: error instanceof Error ? error.message : 'unknown_error',
            });
            const transient =
              error instanceof AdaptiveStrategyError && error.category === 'TRANSIENT';
            if (transient && attempts < step.maxAttempts && retries < budget.maxRetries) {
              retries += 1;
              await this.eventSink({
                type: 'STRATEGY_RETRY',
                stepId: step.id,
                strategyId: strategy.id,
                reason: error.reason,
              });
              await this.sleep(Math.min(budget.baseBackoffMs * 2 ** (retries - 1), 60_000), signal);
              continue;
            }
            break;
          }
        }
        if (verified) break;
      }
      if (!verified && step.required) {
        await this.eventSink({
          type: 'PLAN_BLOCKED',
          stepId: step.id,
          reason: 'no_verified_strategy',
        });
        throw new AdaptiveRunError(`required_step_failed:${step.id}`);
      }
    }
    return { completedSteps, evidence, actions, retries, modelTokens };
  }
}

export type ControlMode =
  'AUTOMATION' | 'FOCUS' | 'TAKEOVER' | 'PAUSED_USER_ACTIVITY' | 'RECOVERING' | 'EMERGENCY_STOP';

export class HumanTakeoverController {
  private mode: ControlMode = 'AUTOMATION';
  private checkpoint?: Readonly<{ id: string; contextFingerprint: string }>;
  private resumeMode: 'AUTOMATION' | 'FOCUS' = 'AUTOMATION';

  current(): ControlMode {
    return this.mode;
  }

  takeover(checkpoint: Readonly<{ id: string; contextFingerprint: string }>): void {
    if (this.mode === 'EMERGENCY_STOP') throw new AdaptiveRunError('emergency_stop_active');
    this.resumeMode = this.mode === 'FOCUS' ? 'FOCUS' : 'AUTOMATION';
    this.checkpoint = checkpoint;
    this.mode = 'TAKEOVER';
  }

  enterFocus(checkpoint: Readonly<{ id: string; contextFingerprint: string }>): void {
    if (this.mode !== 'AUTOMATION') throw new AdaptiveRunError('focus_mode_unavailable');
    this.checkpoint = checkpoint;
    this.resumeMode = 'FOCUS';
    this.mode = 'FOCUS';
  }

  exitFocus(): void {
    if (this.mode !== 'FOCUS') throw new AdaptiveRunError('focus_mode_not_active');
    this.resumeMode = 'AUTOMATION';
    this.mode = 'AUTOMATION';
  }

  pauseForUserActivity(checkpoint: Readonly<{ id: string; contextFingerprint: string }>): void {
    if (!['AUTOMATION', 'FOCUS'].includes(this.mode)) {
      throw new AdaptiveRunError('automation_not_active');
    }
    this.resumeMode = this.mode === 'FOCUS' ? 'FOCUS' : 'AUTOMATION';
    this.checkpoint = checkpoint;
    this.mode = 'PAUSED_USER_ACTIVITY';
  }

  continue(currentContextFingerprint: string): 'RESUMED' | 'REVALIDATION_REQUIRED' {
    if (!['TAKEOVER', 'PAUSED_USER_ACTIVITY'].includes(this.mode) || !this.checkpoint)
      throw new AdaptiveRunError('takeover_not_active');
    if (this.checkpoint.contextFingerprint !== currentContextFingerprint) {
      this.mode = 'RECOVERING';
      return 'REVALIDATION_REQUIRED';
    }
    this.mode = this.resumeMode;
    return 'RESUMED';
  }

  completeRecovery(newCheckpoint: Readonly<{ id: string; contextFingerprint: string }>): void {
    if (this.mode !== 'RECOVERING') throw new AdaptiveRunError('recovery_not_active');
    this.checkpoint = newCheckpoint;
    this.mode = this.resumeMode;
  }

  emergencyStop(): void {
    this.mode = 'EMERGENCY_STOP';
  }
}
