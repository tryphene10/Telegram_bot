import {
  assertApprovalTransition,
  assertMissionTransition,
  assertToolExecutionTransition,
  type ApprovalStatus,
  type MissionStatus,
  type ToolExecutionStatus,
} from './states.js';
import type { SqlClient } from './sql.js';

export interface RejectedTransition {
  readonly entity: 'mission' | 'approval' | 'tool_execution';
  readonly entityPublicId: string;
  readonly from: string;
  readonly to: string;
  readonly correlationId: string;
}

export interface TransitionAuditSink {
  recordRejectedTransition(event: RejectedTransition): Promise<void>;
}

export class SqlTransitionAuditSink implements TransitionAuditSink {
  constructor(private readonly sql: SqlClient) {}

  async recordRejectedTransition(event: RejectedTransition): Promise<void> {
    await this.sql.query(
      `select append_audit_log(
        'STATE_TRANSITION_REJECTED',
        'reject_transition',
        $1::uuid,
        jsonb_build_object(
          'entity', $2::text,
          'entity_public_id', $3::text,
          'from', $4::text,
          'to', $5::text
        )
      )`,
      [event.correlationId, event.entity, event.entityPublicId, event.from, event.to],
    );
  }
}

export class AuditedStateTransitions {
  constructor(private readonly audit: TransitionAuditSink) {}

  async mission(
    entityPublicId: string,
    from: MissionStatus,
    to: MissionStatus,
    correlationId: string,
  ): Promise<void> {
    await this.check('mission', entityPublicId, from, to, correlationId, assertMissionTransition);
  }

  async approval(
    entityPublicId: string,
    from: ApprovalStatus,
    to: ApprovalStatus,
    correlationId: string,
  ): Promise<void> {
    await this.check('approval', entityPublicId, from, to, correlationId, assertApprovalTransition);
  }

  async toolExecution(
    entityPublicId: string,
    from: ToolExecutionStatus,
    to: ToolExecutionStatus,
    correlationId: string,
  ): Promise<void> {
    await this.check(
      'tool_execution',
      entityPublicId,
      from,
      to,
      correlationId,
      assertToolExecutionTransition,
    );
  }

  private async check<T extends string>(
    entity: RejectedTransition['entity'],
    entityPublicId: string,
    from: T,
    to: T,
    correlationId: string,
    assertion: (from: T, to: T) => void,
  ): Promise<void> {
    try {
      assertion(from, to);
    } catch (error) {
      await this.audit.recordRejectedTransition({
        entity,
        entityPublicId,
        from,
        to,
        correlationId,
      });
      throw error;
    }
  }
}
