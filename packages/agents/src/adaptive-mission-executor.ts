import type { DeterministicStepExecutor, StepOutcome } from './mission-engine.js';
import type { MissionAggregate, MissionStep } from './mission-runtime.js';

export type AdaptiveDesktopOutcome =
  | Readonly<{
      status: 'COMPLETED';
      evidence: readonly string[];
      completedStepIds: readonly string[];
      actions: number;
      retries: number;
      checkpointId: string;
    }>
  | Readonly<{ status: 'WAITING_APPROVAL'; approvalId: string }>
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

export interface AdaptiveDesktopExecutionPort {
  execute(input: {
    readonly missionId: string;
    readonly adaptivePlanId: string;
    readonly idempotencyKey: string;
    readonly actionHash: string;
    readonly signal: AbortSignal;
  }): Promise<AdaptiveDesktopOutcome>;
}

const EXPECTED_ACTION: Readonly<
  Record<Extract<AdaptiveDesktopOutcome, { status: 'BLOCKED' }>['cause'], string>
> = {
  STALE_CONTEXT: 'Recalculer et valider le plan depuis le nouveau contexte',
  USER_ACTIVITY: 'Restituer le controle puis utiliser /continue apres verification',
  UNKNOWN_RESULT: 'Verifier manuellement le resultat avant toute reprise',
  EMERGENCY_STOP: 'Reinitialiser localement le kill switch avant toute reprise',
  NO_VERIFIED_STRATEGY: 'Choisir une strategie autorisee ou corriger le plan',
};

export class AdaptiveMissionStepExecutor implements DeterministicStepExecutor {
  constructor(private readonly desktop: AdaptiveDesktopExecutionPort) {}

  async execute(input: {
    readonly mission: MissionAggregate;
    readonly step: MissionStep;
    readonly idempotencyKey: string;
    readonly actionHash: string;
    readonly signal: AbortSignal;
  }): Promise<StepOutcome> {
    if (input.step.executionKind !== 'ADAPTIVE_DESKTOP' || !input.step.adaptivePlanId) {
      return {
        status: 'BLOCKED',
        cause: 'invalid_adaptive_desktop_step',
        expectedAction: 'Corriger le plan de mission',
      };
    }
    const outcome = await this.desktop.execute({
      missionId: input.mission.id,
      adaptivePlanId: input.step.adaptivePlanId,
      idempotencyKey: input.idempotencyKey,
      actionHash: input.actionHash,
      signal: input.signal,
    });
    if (outcome.status === 'COMPLETED') {
      if (outcome.evidence.length === 0) {
        return {
          status: 'BLOCKED',
          cause: 'adaptive_evidence_missing',
          expectedAction: 'Fournir une preuve objective pour chaque etape obligatoire',
        };
      }
      return {
        status: 'COMPLETED',
        result: {
          evidence: [...outcome.evidence],
          completedStepIds: [...outcome.completedStepIds],
          actions: outcome.actions,
          retries: outcome.retries,
          checkpointId: outcome.checkpointId,
        },
      };
    }
    if (outcome.status === 'WAITING_APPROVAL') return outcome;
    if (outcome.status === 'FAILED') return outcome;
    return {
      status: 'BLOCKED',
      cause: `adaptive_${outcome.cause.toLowerCase()}`,
      expectedAction: outcome.detail?.trim() || EXPECTED_ACTION[outcome.cause],
    };
  }
}

export class RoutedMissionStepExecutor implements DeterministicStepExecutor {
  constructor(
    private readonly specialist: DeterministicStepExecutor,
    private readonly adaptiveDesktop: DeterministicStepExecutor,
  ) {}

  execute(input: Parameters<DeterministicStepExecutor['execute']>[0]): Promise<StepOutcome> {
    return input.step.executionKind === 'ADAPTIVE_DESKTOP'
      ? this.adaptiveDesktop.execute(input)
      : this.specialist.execute(input);
  }
}
