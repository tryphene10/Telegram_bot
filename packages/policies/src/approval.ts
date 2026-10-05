import { randomUUID } from 'node:crypto';
import { hashPolicyAction, type PolicyInput, type PolicyResult } from './index.js';

export interface ApprovalRecord {
  readonly id: string;
  readonly missionId: string;
  readonly requesterUserId: string;
  readonly actionHash: string;
  readonly level: 'APPROVAL' | 'STRONG_APPROVAL';
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
  readonly expiresAt: number;
  readonly authorizationId?: string;
  readonly consumedAt?: number;
}

export interface ApprovalStore {
  get(id: string): Promise<ApprovalRecord | null>;
  save(approval: ApprovalRecord): Promise<void>;
}

export interface ApprovalMissionPort {
  waitingForApproval(missionId: string, approvalId: string): Promise<void>;
  resume(missionId: string, authorizationId: string): Promise<void>;
}

export interface ApprovalAuditSink {
  record(event: {
    readonly approvalId: string;
    readonly missionId: string;
    readonly actionHash: string;
    readonly decision: string;
    readonly reason: string;
  }): Promise<void>;
}

export class ApprovalError extends Error {
  constructor(readonly reason: string) {
    super(`Approval denied: ${reason}`);
    this.name = 'ApprovalError';
  }
}

export class ApprovalService {
  constructor(
    private readonly store: ApprovalStore,
    private readonly missions: ApprovalMissionPort,
    private readonly audit: ApprovalAuditSink,
    private readonly now: () => number = Date.now,
  ) {}

  async request(
    missionId: string,
    input: PolicyInput,
    policy: PolicyResult,
    lifetimeMs = 2 * 60 * 1000,
  ): Promise<ApprovalRecord> {
    if (policy.decision !== 'REQUIRE_APPROVAL' && policy.decision !== 'REQUIRE_STRONG_APPROVAL') {
      throw new ApprovalError('policy_does_not_require_approval');
    }
    if (policy.actionHash !== hashPolicyAction(input)) {
      throw new ApprovalError('policy_action_mismatch');
    }
    const approval: ApprovalRecord = {
      id: randomUUID(),
      missionId,
      requesterUserId: input.userId,
      actionHash: policy.actionHash,
      level: policy.decision === 'REQUIRE_STRONG_APPROVAL' ? 'STRONG_APPROVAL' : 'APPROVAL',
      status: 'PENDING',
      expiresAt: this.now() + lifetimeMs,
    };
    await this.store.save(approval);
    await this.missions.waitingForApproval(missionId, approval.id);
    await this.audit.record({
      approvalId: approval.id,
      missionId,
      actionHash: approval.actionHash,
      decision: 'REQUESTED',
      reason: approval.level,
    });
    return approval;
  }

  async approve(
    approvalId: string,
    actingUserId: string,
    currentAction: PolicyInput,
    proof: 'TELEGRAM_CONFIRM' | 'PIN_VERIFIED',
  ): Promise<string> {
    const approval = await this.pending(approvalId);
    if (approval.expiresAt <= this.now()) {
      await this.store.save({ ...approval, status: 'EXPIRED' });
      return this.deny(approval, 'expired');
    }
    if (
      actingUserId !== approval.requesterUserId ||
      hashPolicyAction(currentAction) !== approval.actionHash
    ) {
      await this.store.save({ ...approval, status: 'CANCELLED' });
      return this.deny(approval, 'identity_or_action_changed');
    }
    if (approval.level === 'STRONG_APPROVAL' && proof !== 'PIN_VERIFIED') {
      return this.deny(approval, 'pin_required');
    }
    const authorizationId = randomUUID();
    await this.store.save({ ...approval, status: 'APPROVED', authorizationId });
    await this.audit.record({
      approvalId,
      missionId: approval.missionId,
      actionHash: approval.actionHash,
      decision: 'APPROVED',
      reason: proof,
    });
    return authorizationId;
  }

  async consume(
    approvalId: string,
    authorizationId: string,
    currentAction: PolicyInput,
  ): Promise<void> {
    const approval = await this.store.get(approvalId);
    if (
      !approval ||
      approval.status !== 'APPROVED' ||
      approval.consumedAt !== undefined ||
      approval.authorizationId !== authorizationId ||
      approval.actionHash !== hashPolicyAction(currentAction)
    ) {
      throw new ApprovalError('approval_invalid_or_consumed');
    }
    await this.store.save({ ...approval, consumedAt: this.now() });
    await this.missions.resume(approval.missionId, authorizationId);
    await this.audit.record({
      approvalId,
      missionId: approval.missionId,
      actionHash: approval.actionHash,
      decision: 'CONSUMED',
      reason: 'one_time_authorization_used',
    });
  }

  async reject(approvalId: string): Promise<void> {
    const approval = await this.pending(approvalId);
    await this.store.save({ ...approval, status: 'REJECTED' });
    await this.audit.record({
      approvalId,
      missionId: approval.missionId,
      actionHash: approval.actionHash,
      decision: 'REJECTED',
      reason: 'user_rejected',
    });
  }

  async cancel(approvalId: string): Promise<void> {
    const approval = await this.pending(approvalId);
    await this.store.save({ ...approval, status: 'CANCELLED' });
    await this.audit.record({
      approvalId,
      missionId: approval.missionId,
      actionHash: approval.actionHash,
      decision: 'CANCELLED',
      reason: 'request_cancelled',
    });
  }

  private async pending(id: string): Promise<ApprovalRecord> {
    const approval = await this.store.get(id);
    if (!approval || approval.status !== 'PENDING') {
      throw new ApprovalError('unknown_or_replayed_approval');
    }
    return approval;
  }

  private async deny(approval: ApprovalRecord, reason: string): Promise<never> {
    await this.audit.record({
      approvalId: approval.id,
      missionId: approval.missionId,
      actionHash: approval.actionHash,
      decision: 'DENIED',
      reason,
    });
    throw new ApprovalError(reason);
  }
}
