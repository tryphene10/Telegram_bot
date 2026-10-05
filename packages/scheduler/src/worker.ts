import type { PolicyResult } from '@arcc/policies';
import { authorizeAutonomy } from './autonomy.js';
import type { ClaimedOccurrence } from './types.js';

export interface SchedulerControlSnapshot {
  readonly globallyPaused: boolean;
  readonly pauseGeneration: number;
}
export interface OccurrenceStore {
  control(): Promise<SchedulerControlSnapshot>;
  claim(worker: string, leaseSeconds: number): Promise<ClaimedOccurrence | undefined>;
  heartbeat(id: string, worker: string, leaseSeconds: number): Promise<boolean>;
  complete(id: string, worker: string, result: Readonly<Record<string, unknown>>): Promise<void>;
  block(id: string, worker: string, reason: string, actionHash?: string): Promise<void>;
  waitApproval(id: string, worker: string, actionHash: string): Promise<void>;
  unknown(id: string, worker: string, errorCode: string): Promise<void>;
  fail(id: string, worker: string, errorCode: string, retryable: boolean): Promise<void>;
}
export interface SchedulerPolicyPort {
  evaluate(occurrence: ClaimedOccurrence): Promise<PolicyResult>;
}
export interface ScheduledMissionPort {
  execute(input: {
    readonly idempotencyKey: string;
    readonly occurrenceId: string;
    readonly projectId?: string;
    readonly missionTemplate: Readonly<Record<string, unknown>>;
  }): Promise<Readonly<Record<string, unknown>>>;
}
export interface SchedulerWorkerAuditPort {
  record(event: Readonly<Record<string, unknown>>): Promise<void>;
}

export class SchedulerWorker {
  constructor(
    private readonly store: OccurrenceStore,
    private readonly policy: SchedulerPolicyPort,
    private readonly missions: ScheduledMissionPort,
    private readonly audit: SchedulerWorkerAuditPort,
    private readonly worker: string,
    private readonly leaseSeconds = 60,
  ) {}

  async runOnce(): Promise<
    | 'IDLE'
    | 'PAUSED'
    | 'OBSERVED'
    | 'PROPOSED'
    | 'WAITING_APPROVAL'
    | 'BLOCKED'
    | 'COMPLETED'
    | 'UNKNOWN'
    | 'RETRYING'
    | 'FAILED'
  > {
    const before = await this.store.control();
    if (before.globallyPaused) return 'PAUSED';
    const occurrence = await this.store.claim(this.worker, this.leaseSeconds);
    if (!occurrence) return 'IDLE';
    try {
      const policy = await this.policy.evaluate(occurrence);
      const authorization = authorizeAutonomy(occurrence.autonomyLevel, occurrence.risk, policy);
      await this.audit.record({
        event: 'SCHEDULE_POLICY_REEVALUATED',
        occurrenceId: occurrence.id,
        occurrenceKey: occurrence.occurrenceKey,
        decision: authorization.outcome,
        actionHash: policy.actionHash,
      });
      if (authorization.outcome === 'OBSERVE' || authorization.outcome === 'PROPOSE') {
        await this.store.complete(occurrence.id, this.worker, { outcome: authorization.outcome });
        return authorization.outcome === 'OBSERVE' ? 'OBSERVED' : 'PROPOSED';
      }
      if (authorization.outcome === 'DENY') {
        await this.store.block(occurrence.id, this.worker, authorization.reason, policy.actionHash);
        return 'BLOCKED';
      }
      if (authorization.outcome === 'WAIT_APPROVAL') {
        await this.store.waitApproval(occurrence.id, this.worker, policy.actionHash);
        return 'WAITING_APPROVAL';
      }
      const current = await this.store.control();
      if (current.globallyPaused || current.pauseGeneration !== occurrence.pauseGeneration) {
        await this.store.block(occurrence.id, this.worker, 'global_pause_activated');
        return 'BLOCKED';
      }
      await this.store.heartbeat(occurrence.id, this.worker, this.leaseSeconds);
      try {
        const result = await this.missions.execute({
          idempotencyKey: occurrence.idempotencyKey,
          occurrenceId: occurrence.id,
          ...(occurrence.projectId ? { projectId: occurrence.projectId } : {}),
          missionTemplate: occurrence.missionTemplate,
        });
        await this.store.complete(occurrence.id, this.worker, result);
        return 'COMPLETED';
      } catch (error) {
        await this.store.unknown(occurrence.id, this.worker, 'EXECUTION_OUTCOME_UNKNOWN');
        await this.audit.record({
          event: 'SCHEDULE_EXECUTION_UNKNOWN',
          occurrenceId: occurrence.id,
          error: error instanceof Error ? error.name : 'unknown',
        });
        return 'UNKNOWN';
      }
    } catch {
      const retryable = occurrence.attempts < occurrence.maxAttempts;
      await this.store.fail(occurrence.id, this.worker, 'SCHEDULER_WORKER_FAILURE', retryable);
      return retryable ? 'RETRYING' : 'FAILED';
    }
  }
}
