import type { MissionAggregate } from './mission-runtime.js';
import type { ObjectiveVerifier } from './mission-engine.js';

export const VERIFICATION_KINDS = ['TEST', 'BUILD', 'LINT', 'TYPECHECK', 'CUSTOM'] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

export interface VerificationCheck {
  readonly id: string;
  readonly kind: VerificationKind;
  readonly profile: string;
  readonly required: boolean;
}

export interface VerificationManifest {
  readonly checks: readonly VerificationCheck[];
}

export interface VerificationRunner {
  run(input: {
    readonly missionId: string;
    readonly projectId: string;
    readonly check: VerificationCheck;
  }): Promise<{
    readonly passed: boolean;
    readonly summary: string;
    readonly evidenceReference?: string;
  }>;
}

function resultStrings(
  mission: MissionAggregate,
  field: 'facts' | 'hypotheses' | 'risks',
): string[] {
  return mission.plan.flatMap((step) => {
    const value = step.result?.[field];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  });
}

export class ManifestObjectiveVerifier implements ObjectiveVerifier {
  constructor(
    private readonly manifest: VerificationManifest,
    private readonly runner: VerificationRunner,
  ) {
    if (manifest.checks.length === 0 || manifest.checks.length > 20) {
      throw new Error('invalid_verification_manifest');
    }
    if (new Set(manifest.checks.map(({ id }) => id)).size !== manifest.checks.length) {
      throw new Error('duplicate_verification_check');
    }
  }

  async verify(mission: MissionAggregate): Promise<{
    readonly passed: boolean;
    readonly evidence: readonly string[];
    readonly remainingRisks: readonly string[];
    readonly verifiedFacts: readonly string[];
    readonly hypotheses: readonly string[];
  }> {
    const results = [];
    for (const check of this.manifest.checks) {
      if (!VERIFICATION_KINDS.includes(check.kind) || !check.id.trim() || !check.profile.trim()) {
        throw new Error('invalid_verification_check');
      }
      results.push({
        check,
        result: await this.runner.run({
          missionId: mission.id,
          projectId: mission.definition.projectId,
          check,
        }),
      });
    }
    const failedRequired = results.filter(({ check, result }) => check.required && !result.passed);
    const evidence = results
      .filter(({ result }) => result.passed)
      .map(
        ({ check, result }) =>
          `${check.kind}:${check.id}:${result.evidenceReference ?? result.summary}`,
      );
    return {
      passed: failedRequired.length === 0 && evidence.length > 0,
      evidence,
      verifiedFacts: [
        ...resultStrings(mission, 'facts'),
        ...results.filter(({ result }) => result.passed).map(({ check }) => `${check.kind} reussi`),
      ],
      hypotheses: resultStrings(mission, 'hypotheses'),
      remainingRisks: [
        ...resultStrings(mission, 'risks'),
        ...results
          .filter(({ result }) => !result.passed)
          .map(({ check, result }) => `${check.kind}:${check.id}:${result.summary}`),
      ],
    };
  }
}
