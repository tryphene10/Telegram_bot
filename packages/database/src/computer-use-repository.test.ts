import { describe, expect, it, vi } from 'vitest';
import { ComputerUseRepository } from './computer-use-repository.js';
import type { SqlClient } from './sql.js';

describe('ComputerUseRepository', () => {
  it('creates a mission-bound local Computer Use session', async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          public_id: 'session-1',
          status: 'CREATED',
          control_mode: 'AUTOMATION',
          target_fingerprint: 'window-a',
          checkpoint: null,
          emergency_stop: false,
        },
      ],
    });
    const repository = new ComputerUseRepository({ query } as unknown as SqlClient);
    const session = await repository.createSession({
      missionPublicId: '11111111-1111-1111-1111-111111111111',
      machinePublicId: '22222222-2222-2222-2222-222222222222',
      targetFingerprint: 'window-a',
    });
    expect(session).toMatchObject({ publicId: 'session-1', targetFingerprint: 'window-a' });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('computer_use_sessions'), [
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      null,
      'window-a',
    ]);
  });

  it('claims the global UI lease only through a guarded update', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const repository = new ComputerUseRepository({ query } as unknown as SqlClient);
    await expect(
      repository.acquireUiLease({ sessionPublicId: 'session-1', owner: 'worker-1' }),
    ).resolves.toBe(true);
    expect(query.mock.calls[0]?.[0]).toContain('not exists');
  });

  it('makes emergency stop durable and releases the lease', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const repository = new ComputerUseRepository({ query } as unknown as SqlClient);
    await repository.emergencyStop('session-1');
    expect(query.mock.calls[0]?.[0]).toContain('emergency_stop = true');
    expect(query.mock.calls[0]?.[0]).toContain('lease_owner = null');
  });

  it('reserves an idempotent action and never authorizes replay of an existing result', async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          public_id: 'action-1',
          status: 'UNKNOWN',
          action_hash: 'a'.repeat(64),
          verification: null,
          owned: false,
        },
      ],
    });
    const repository = new ComputerUseRepository({ query } as unknown as SqlClient);
    await expect(
      repository.reserveAction({
        sessionPublicId: 'session-1',
        sequence: 1,
        actionHash: 'a'.repeat(64),
        channel: 'UIA',
        risk: 'MEDIUM',
        request: { selector: 'save' },
      }),
    ).resolves.toMatchObject({ status: 'UNKNOWN', owned: false, replayAllowed: false });
    expect(query.mock.calls[0]?.[0]).toContain('on conflict (session_id, action_hash) do nothing');
  });

  it('recovers only from a valid checkpoint and marks in-flight actions unknown', async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          public_id: 'session-1',
          status: 'WAITING_FOR_USER',
          control_mode: 'AUTOMATION',
          target_fingerprint: 'window-a',
          checkpoint: { id: 'checkpoint-1' },
          emergency_stop: false,
        },
      ],
    });
    const repository = new ComputerUseRepository({ query } as unknown as SqlClient);
    await expect(repository.recoverInterrupted('session-1', 'window-a')).resolves.toMatchObject({
      status: 'WAITING_FOR_USER',
      checkpoint: { id: 'checkpoint-1' },
    });
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("set status = 'UNKNOWN'");
    expect(sql).toContain('target.checkpoint is null');
    expect(sql).toContain('target.target_fingerprint is distinct from $2');
  });
});
