import { describe, expect, it, vi } from 'vitest';
import { MissionRuntimeRepository } from './mission-runtime-repository.js';
import type { SqlClient } from './sql.js';

const row = {
  public_id: '11111111-1111-4111-8111-111111111111',
  status: 'PLANNING',
  normalized_goal: 'Build safely',
  context: {},
  success_criteria: ['tests pass'],
  definition_of_done: ['verified'],
  submission_sequence: '7',
  execution_epoch: 1,
  version: 2,
};

describe('MissionRuntimeRepository', () => {
  it('claims missions atomically in submission order', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row], rowCount: 1 });
    const result = await new MissionRuntimeRepository({ query } as SqlClient).claimNext('worker-1');
    expect(result?.submissionSequence).toBe(7);
    expect(query.mock.calls[0]?.[0]).toContain('order by submission_sequence asc');
    expect(query.mock.calls[0]?.[0]).toContain('for update skip locked');
  });

  it('recovers expired active missions without duplicating completed receipts', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 3 });
    await expect(
      new MissionRuntimeRepository({ query } as SqlClient).recoverExpired(),
    ).resolves.toBe(3);
    expect(query.mock.calls[0]?.[0]).toContain("status in ('PLANNING', 'RUNNING', 'VERIFYING')");
    expect(query.mock.calls[0]?.[0]).not.toContain('mission_action_receipts');
  });

  it('returns an existing action receipt on an idempotent retry', async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          public_id: 'receipt',
          status: 'COMPLETED',
          action_hash: 'a'.repeat(64),
          result_sanitized: { ok: true },
          owned: false,
        },
      ],
    });
    const result = await new MissionRuntimeRepository({ query } as SqlClient).reserveAction({
      missionPublicId: 'mission',
      stepPublicId: 'step',
      idempotencyKey: 'mission:step:1',
      actionHash: 'a'.repeat(64),
      worker: 'worker',
    });
    expect(result).toMatchObject({ status: 'COMPLETED', owned: false, result: { ok: true } });
    expect(query.mock.calls[0]?.[0]).toContain('on conflict (idempotency_key) do nothing');
  });

  it('fails closed when an idempotency key is reused for another action', async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          public_id: 'receipt',
          status: 'COMPLETED',
          action_hash: 'b'.repeat(64),
          result_sanitized: {},
          owned: false,
        },
      ],
    });
    await expect(
      new MissionRuntimeRepository({ query } as SqlClient).reserveAction({
        missionPublicId: 'mission',
        stepPublicId: 'step',
        idempotencyKey: 'same-key',
        actionHash: 'a'.repeat(64),
        worker: 'worker',
      }),
    ).rejects.toThrow('action_idempotency_conflict');
  });

  it('acquires a project lease only when absent, expired or already owned', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{}], rowCount: 1 });
    await expect(
      new MissionRuntimeRepository({ query } as SqlClient).acquireProjectLease({
        missionPublicId: 'mission',
        projectPublicId: 'project',
        worker: 'worker',
      }),
    ).resolves.toBe(true);
    expect(query.mock.calls[0]?.[0]).toContain('project_execution_leases.expires_at < now()');
  });
});
