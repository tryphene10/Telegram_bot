import { createHash } from 'node:crypto';

export const POLICY_DECISIONS = [
  'ALLOW',
  'DENY',
  'REQUIRE_APPROVAL',
  'REQUIRE_STRONG_APPROVAL',
] as const;
export type PolicyDecision = (typeof POLICY_DECISIONS)[number];
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ActionCategory =
  | 'READ'
  | 'WRITE'
  | 'PUSH'
  | 'PRODUCTION'
  | 'PUBLICATION'
  | 'PAYMENT'
  | 'IRREVERSIBLE_DELETE'
  | 'DEPENDENCY_INSTALL'
  | 'PERSISTENT_PROCESS'
  | 'NETWORK_ACCESS'
  | 'GIT_COMMIT'
  | 'CONTAINER_BUILD'
  | 'CONTAINER_CONTROL';

export interface PolicyInput {
  readonly userId: string;
  readonly userStatus: 'ACTIVE' | 'LOCKED' | 'REVOKED';
  readonly projectId: string;
  readonly projectStatus: 'ACTIVE' | 'ARCHIVED';
  readonly machineId: string;
  readonly machineStatus: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE' | 'REVOKED';
  readonly tool: { readonly key: string; readonly risk: RiskLevel; readonly enabled: boolean };
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly environment: 'LOCAL' | 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';
  readonly classification: 'PUBLIC' | 'CLOUD_SAFE' | 'LOCAL_ONLY' | 'SECRET';
  readonly actionCategory: ActionCategory;
  readonly evaluationHealthy: boolean;
  readonly connectionAvailable: boolean;
}

export interface PolicyRules {
  readonly deniedTools: ReadonlySet<string>;
  readonly allowedTools?: ReadonlySet<string>;
  readonly riskDecisions: Readonly<Record<RiskLevel, PolicyDecision>>;
}

export interface PolicyResult {
  readonly decision: PolicyDecision;
  readonly reason: string;
  readonly explanation: string;
  readonly actionHash: string;
}

export const DEFAULT_RISK_DECISIONS: Readonly<Record<RiskLevel, PolicyDecision>> = {
  LOW: 'ALLOW',
  MEDIUM: 'REQUIRE_APPROVAL',
  HIGH: 'REQUIRE_STRONG_APPROVAL',
  CRITICAL: 'REQUIRE_STRONG_APPROVAL',
};

const alwaysStrong = new Set<ActionCategory>([
  'PUSH',
  'PRODUCTION',
  'PUBLICATION',
  'PAYMENT',
  'IRREVERSIBLE_DELETE',
  'DEPENDENCY_INSTALL',
  'NETWORK_ACCESS',
  'GIT_COMMIT',
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

export function hashPolicyAction(input: PolicyInput): string {
  const identityAndAction = {
    userId: input.userId,
    projectId: input.projectId,
    machineId: input.machineId,
    tool: input.tool.key,
    parameters: input.parameters,
    environment: input.environment,
    classification: input.classification,
    actionCategory: input.actionCategory,
  };
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(identityAndAction)), 'utf8')
    .digest('hex');
}

export interface PolicyAuditSink {
  record(event: {
    readonly actionHash: string;
    readonly decision: PolicyDecision;
    readonly reason: string;
    readonly tool: string;
    readonly risk: RiskLevel;
  }): Promise<void>;
}

export class PolicyEngine {
  constructor(
    private readonly audit: PolicyAuditSink,
    private readonly rules: PolicyRules = {
      deniedTools: new Set(),
      riskDecisions: DEFAULT_RISK_DECISIONS,
    },
  ) {}

  async evaluate(input: PolicyInput): Promise<PolicyResult> {
    const actionHash = hashPolicyAction(input);
    let decision: PolicyDecision;
    let reason: string;

    if (!input.evaluationHealthy) {
      decision = 'DENY';
      reason = 'evaluation_unavailable';
    } else if (!input.connectionAvailable || input.machineStatus === 'OFFLINE') {
      decision = 'DENY';
      reason = 'machine_unavailable';
    } else if (
      input.userStatus !== 'ACTIVE' ||
      input.projectStatus !== 'ACTIVE' ||
      input.machineStatus === 'REVOKED' ||
      input.machineStatus === 'MAINTENANCE'
    ) {
      decision = 'DENY';
      reason = 'inactive_security_context';
    } else if (!input.tool.enabled) {
      decision = 'DENY';
      reason = 'tool_disabled';
    } else if (
      this.rules.deniedTools.has(input.tool.key) ||
      (this.rules.allowedTools && !this.rules.allowedTools.has(input.tool.key))
    ) {
      decision = 'DENY';
      reason = 'tool_not_allowed';
    } else if (input.classification === 'SECRET') {
      decision = 'DENY';
      reason = 'secret_parameter_forbidden';
    } else if (alwaysStrong.has(input.actionCategory) || input.environment === 'PRODUCTION') {
      decision = 'REQUIRE_STRONG_APPROVAL';
      reason = 'strong_approval_mandatory';
    } else {
      decision = this.rules.riskDecisions[input.tool.risk];
      reason = `risk_${input.tool.risk.toLowerCase()}`;
    }

    const result = {
      decision,
      reason,
      explanation: this.explain(decision, reason, input),
      actionHash,
    };
    await this.audit.record({
      actionHash,
      decision,
      reason,
      tool: input.tool.key,
      risk: input.tool.risk,
    });
    return result;
  }

  private explain(decision: PolicyDecision, reason: string, input: PolicyInput): string {
    return `${decision}: ${input.tool.key} (${input.tool.risk}) — ${reason}.`;
  }
}

export * from './approval.js';
