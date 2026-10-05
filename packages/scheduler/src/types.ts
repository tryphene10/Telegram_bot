import type { PolicyDecision, RiskLevel } from '@arcc/policies';

export type TriggerType = 'ONE_SHOT' | 'INTERVAL' | 'CRON' | 'LOCAL_EVENT';
export type CatchUpPolicy = 'SKIP' | 'LATEST_ONLY' | 'BOUNDED';
export type AutonomyLevel = 'OBSERVE' | 'ASSIST' | 'EXECUTE_SAFE' | 'AUTONOMOUS';
export type OccurrenceStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'BLOCKED'
  | 'FAILED'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'UNKNOWN';

export interface ScheduleDefinition {
  readonly id: string;
  readonly projectId?: string;
  readonly triggerType: TriggerType;
  readonly expression: string;
  readonly timezone: string;
  readonly catchUpPolicy: CatchUpPolicy;
  readonly catchUpLimit: number;
  readonly window?: Readonly<{ start: string; end: string }>;
  readonly nextRunAt?: string;
}

export interface DueOccurrence {
  readonly key: string;
  readonly dueAt: string;
}

export interface ClaimedOccurrence {
  readonly id: string;
  readonly scheduleId: string;
  readonly occurrenceKey: string;
  readonly idempotencyKey: string;
  readonly projectId?: string;
  readonly autonomyLevel: AutonomyLevel;
  readonly risk: RiskLevel;
  readonly missionTemplate: Readonly<Record<string, unknown>>;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly pauseGeneration: number;
}

export interface ExecutionAuthorization {
  readonly outcome: 'OBSERVE' | 'PROPOSE' | 'EXECUTE' | 'WAIT_APPROVAL' | 'DENY';
  readonly reason: string;
  readonly actionHash?: string;
  readonly policyDecision?: PolicyDecision;
}
