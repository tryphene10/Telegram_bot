import { describe, expect, it, vi } from 'vitest';
import { hashPin } from '@arcc/security';
import { TelegramStrongApprovalGate } from './pin-gate.js';

describe('TelegramStrongApprovalGate', () => {
  it('authorizes the exact action without exposing the PIN to audit', async () => {
    const record = vi.fn(async () => undefined);
    const gate = new TelegramStrongApprovalGate(await hashPin('123456'), { record });
    await expect(gate.authorize('approval-1', '123456')).resolves.toBeUndefined();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: 'approval-1', decision: 'AUTHORIZED' }),
    );
    expect(JSON.stringify(record.mock.calls)).not.toContain('123456');
  });

  it('locks the same approval challenge after five invalid attempts', async () => {
    const gate = new TelegramStrongApprovalGate(await hashPin('123456'), {
      record: vi.fn(async () => undefined),
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(gate.authorize('approval-2', '000000')).rejects.toMatchObject({
        reason: 'invalid_pin',
      });
    }
    await expect(gate.authorize('approval-2', '000000')).rejects.toMatchObject({
      reason: 'attempt_limit_reached',
    });
    await expect(gate.authorize('approval-2', '123456')).rejects.toMatchObject({
      reason: 'unknown_or_replayed_challenge',
    });
  });
});
