import { describe, expect, it, vi } from 'vitest';
import {
  ApprovalService,
  PolicyEngine,
  type ApprovalRecord,
  type ApprovalStore,
  type PolicyInput,
} from './index.js';

class Approvals implements ApprovalStore {
  readonly values = new Map<string, ApprovalRecord>();
  async get(id: string) {
    return this.values.get(id) ?? null;
  }
  async save(approval: ApprovalRecord) {
    this.values.set(approval.id, approval);
  }
}

const action: PolicyInput = {
  userId: 'owner',
  userStatus: 'ACTIVE',
  projectId: 'project',
  projectStatus: 'ACTIVE',
  machineId: 'machine',
  machineStatus: 'ONLINE',
  tool: { key: 'git.push', risk: 'HIGH', enabled: true },
  parameters: { remote: 'origin' },
  environment: 'LOCAL',
  classification: 'LOCAL_ONLY',
  actionCategory: 'PUSH',
  evaluationHealthy: true,
  connectionAvailable: true,
};

describe('ApprovalService', () => {
  it('accepts a Telegram confirmation for a simple approval', async () => {
    const store = new Approvals();
    const audit = { record: vi.fn() };
    const service = new ApprovalService(
      store,
      { waitingForApproval: vi.fn(), resume: vi.fn() },
      audit,
      () => 1_000,
    );
    const mediumAction: PolicyInput = {
      ...action,
      tool: { key: 'files.write', risk: 'MEDIUM', enabled: true },
      actionCategory: 'WRITE',
    };
    const policy = await new PolicyEngine({ record: vi.fn() }).evaluate(mediumAction);
    const approval = await service.request('mission', mediumAction, policy);
    await expect(
      service.approve(approval.id, 'owner', mediumAction, 'TELEGRAM_CONFIRM'),
    ).resolves.toEqual(expect.any(String));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'APPROVED', reason: 'TELEGRAM_CONFIRM' }),
    );
  });

  it('requires PIN for strong approval and consumes it once', async () => {
    const store = new Approvals();
    const missions = { waitingForApproval: vi.fn(), resume: vi.fn() };
    const service = new ApprovalService(store, missions, { record: vi.fn() }, () => 1_000);
    const policy = await new PolicyEngine({ record: vi.fn() }).evaluate(action);
    const approval = await service.request('mission', action, policy);
    await expect(service.approve(approval.id, 'owner', action, 'TELEGRAM_CONFIRM')).rejects.toThrow(
      'pin_required',
    );
    const authorization = await service.approve(approval.id, 'owner', action, 'PIN_VERIFIED');
    await service.consume(approval.id, authorization, action);
    await expect(service.consume(approval.id, authorization, action)).rejects.toThrow(
      'approval_invalid_or_consumed',
    );
    expect(missions.resume).toHaveBeenCalledWith('mission', authorization);
  });

  it('invalidates approval when a parameter or identity changes', async () => {
    const store = new Approvals();
    const service = new ApprovalService(
      store,
      { waitingForApproval: vi.fn(), resume: vi.fn() },
      { record: vi.fn() },
      () => 1_000,
    );
    const policy = await new PolicyEngine({ record: vi.fn() }).evaluate(action);
    const approval = await service.request('mission', action, policy);
    await expect(
      service.approve(
        approval.id,
        'owner',
        { ...action, parameters: { remote: 'other' } },
        'PIN_VERIFIED',
      ),
    ).rejects.toThrow('identity_or_action_changed');
    expect(store.values.get(approval.id)?.status).toBe('CANCELLED');
  });

  it('expires instead of allowing when time is lost', async () => {
    const store = new Approvals();
    let now = 1_000;
    const service = new ApprovalService(
      store,
      { waitingForApproval: vi.fn(), resume: vi.fn() },
      { record: vi.fn() },
      () => now,
    );
    const policy = await new PolicyEngine({ record: vi.fn() }).evaluate(action);
    const approval = await service.request('mission', action, policy, 10);
    now = 1_011;
    await expect(service.approve(approval.id, 'owner', action, 'PIN_VERIFIED')).rejects.toThrow(
      'expired',
    );
  });

  it('audits rejection and cancellation without action parameters', async () => {
    const store = new Approvals();
    const audit = { record: vi.fn() };
    const service = new ApprovalService(
      store,
      { waitingForApproval: vi.fn(), resume: vi.fn() },
      audit,
      () => 1_000,
    );
    const policy = await new PolicyEngine({ record: vi.fn() }).evaluate(action);
    const rejected = await service.request('mission-a', action, policy);
    await service.reject(rejected.id);
    const cancelled = await service.request('mission-b', action, policy);
    await service.cancel(cancelled.id);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: rejected.id, decision: 'REJECTED' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: cancelled.id, decision: 'CANCELLED' }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('origin');
  });
});
