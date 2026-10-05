import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { TelegramNotificationWorker } from './notification-worker.js';

describe('TelegramNotificationWorker', () => {
  it('claims, sends and acknowledges one durable notification', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            public_id: '11111111-1111-4111-8111-111111111111',
            payload_sanitized: { message: 'Mission terminee' },
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const sender = { sendMessage: vi.fn(async () => undefined) };
    const worker = new TelegramNotificationWorker(
      { query } as unknown as Pool,
      {
        load: vi.fn(async () => ({ userId: 42, chatId: 84, status: 'ACTIVE' as const })),
        save: vi.fn(),
      },
      sender,
      'telegram-test',
    );

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(sender.sendMessage).toHaveBeenCalledWith(84, 'Mission terminee', undefined);
    expect(String(query.mock.calls[1]?.[0])).toContain("status='SENT'");
  });

  it('does not claim anything before an active Owner is paired', async () => {
    const query = vi.fn();
    const worker = new TelegramNotificationWorker(
      { query } as unknown as Pool,
      { load: vi.fn(async () => null), save: vi.fn() },
      { sendMessage: vi.fn() },
      'telegram-test',
    );
    await expect(worker.runOnce()).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});
