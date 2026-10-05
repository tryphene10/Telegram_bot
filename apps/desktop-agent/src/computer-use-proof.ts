import { createHash } from 'node:crypto';

export interface VerifiedStepProof {
  readonly stepId: string;
  readonly criterion: string;
  readonly evidenceReferences: readonly string[];
  readonly annotatedArtifactReferences: readonly string[];
  readonly verifiedAt: string;
}

export interface HumanInterventionProof {
  readonly kind: 'TAKEOVER' | 'USER_ACTIVITY' | 'FOCUS';
  readonly checkpointId: string;
  readonly startedAt: string;
  readonly endedAt?: string;
}

export interface ComputerUseProofReport {
  readonly missionId: string;
  readonly planId: string;
  readonly planRevision: number;
  readonly planHash: string;
  readonly status: 'VERIFIED' | 'BLOCKED';
  readonly requiredStepIds: readonly string[];
  readonly verifiedSteps: readonly VerifiedStepProof[];
  readonly actions: number;
  readonly retries: number;
  readonly interventions: readonly HumanInterventionProof[];
  readonly remainingRisks: readonly string[];
  readonly unknownResultActionIds: readonly string[];
  readonly completedAt: string;
  readonly digest: string;
}

function validReference(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/\\-]{0,511}$/u.test(value);
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

export class ComputerUseProofError extends Error {
  constructor(readonly reason: string) {
    super(`Computer use proof rejected: ${reason}`);
    this.name = 'ComputerUseProofError';
  }
}

export class ComputerUseProofCollector {
  private readonly steps = new Map<string, VerifiedStepProof>();
  private readonly interventions: HumanInterventionProof[] = [];
  private readonly risks = new Set<string>();
  private readonly unknownResults = new Set<string>();
  private actionCount = 0;
  private retryCount = 0;

  constructor(
    private readonly missionId: string,
    private readonly plan: Readonly<{
      id: string;
      revision: number;
      hash: string;
      requiredStepIds: readonly string[];
    }>,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (
      !validReference(missionId) ||
      !validReference(plan.id) ||
      !Number.isSafeInteger(plan.revision) ||
      plan.revision < 1 ||
      !/^[a-f0-9]{64}$/u.test(plan.hash) ||
      plan.requiredStepIds.length === 0 ||
      plan.requiredStepIds.some((id) => !validReference(id)) ||
      unique(plan.requiredStepIds).length !== plan.requiredStepIds.length
    ) {
      throw new ComputerUseProofError('invalid_identity');
    }
  }

  recordVerifiedStep(input: {
    readonly stepId: string;
    readonly criterion: string;
    readonly evidenceReferences: readonly string[];
    readonly annotatedArtifactReferences?: readonly string[];
  }): void {
    const artifacts = input.annotatedArtifactReferences ?? [];
    if (
      !validReference(input.stepId) ||
      input.criterion.trim().length === 0 ||
      input.criterion.length > 500 ||
      input.evidenceReferences.length === 0 ||
      input.evidenceReferences.some((reference) => !validReference(reference)) ||
      artifacts.some((reference) => !validReference(reference))
    ) {
      throw new ComputerUseProofError('invalid_step_evidence');
    }
    this.steps.set(input.stepId, {
      stepId: input.stepId,
      criterion: input.criterion,
      evidenceReferences: unique(input.evidenceReferences),
      annotatedArtifactReferences: unique(artifacts),
      verifiedAt: this.now().toISOString(),
    });
  }

  recordExecution(actions: number, retries: number): void {
    if (
      !Number.isSafeInteger(actions) ||
      actions < 0 ||
      !Number.isSafeInteger(retries) ||
      retries < 0 ||
      retries > actions
    ) {
      throw new ComputerUseProofError('invalid_execution_totals');
    }
    this.actionCount += actions;
    this.retryCount += retries;
  }

  recordIntervention(intervention: HumanInterventionProof): void {
    if (
      !validReference(intervention.checkpointId) ||
      !Number.isFinite(Date.parse(intervention.startedAt)) ||
      (intervention.endedAt !== undefined &&
        (!Number.isFinite(Date.parse(intervention.endedAt)) ||
          Date.parse(intervention.endedAt) < Date.parse(intervention.startedAt)))
    ) {
      throw new ComputerUseProofError('invalid_intervention');
    }
    this.interventions.push({ ...intervention });
  }

  recordRemainingRisk(riskCode: string): void {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(riskCode)) {
      throw new ComputerUseProofError('invalid_risk_code');
    }
    this.risks.add(riskCode);
  }

  recordUnknownResult(actionId: string): void {
    if (!validReference(actionId)) throw new ComputerUseProofError('invalid_action_reference');
    this.unknownResults.add(actionId);
  }

  finalize(): ComputerUseProofReport {
    const verifiedSteps = [...this.steps.values()].sort((left, right) =>
      left.stepId.localeCompare(right.stepId),
    );
    const missingRequired = this.plan.requiredStepIds.filter((id) => !this.steps.has(id));
    const completedAt = this.now().toISOString();
    const unsigned = {
      missionId: this.missionId,
      planId: this.plan.id,
      planRevision: this.plan.revision,
      planHash: this.plan.hash,
      status:
        missingRequired.length === 0 && this.unknownResults.size === 0
          ? ('VERIFIED' as const)
          : ('BLOCKED' as const),
      requiredStepIds: [...this.plan.requiredStepIds],
      verifiedSteps,
      actions: this.actionCount,
      retries: this.retryCount,
      interventions: [...this.interventions],
      remainingRisks: [...this.risks].sort(),
      unknownResultActionIds: [...this.unknownResults].sort(),
      completedAt,
    };
    const digest = createHash('sha256').update(JSON.stringify(unsigned), 'utf8').digest('hex');
    return Object.freeze({ ...unsigned, digest });
  }
}
