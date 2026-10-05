import { afterEach, describe, expect, it, vi } from 'vitest';
import { pollTelegram, TelegramApiClient, type TelegramUpdate } from './telegram-api.js';

afterEach(() => vi.unstubAllGlobals());

describe('TelegramApiClient', () => {
  it('uses long polling without exposing the token in errors', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true, result: [] }),
    });
    vi.stubGlobal('fetch', request);
    const token = `123456:${'a'.repeat(30)}`;
    const client = new TelegramApiClient(token);
    await expect(client.getUpdates(42)).resolves.toEqual([]);
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining('/getUpdates'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns a generic error that contains neither token nor Telegram response', async () => {
    const token = `123456:${'b'.repeat(30)}`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const client = new TelegramApiClient(token);
    const error = await client.getUpdates(0).catch((caught: unknown) => caught as Error);
    expect(error.message).toBe('Telegram API rejected the request');
    expect(error.message).not.toContain(token);
  });

  it('recovers from polling failures and isolates a rejected update', async () => {
    const controller = new AbortController();
    const updates: TelegramUpdate[] = [
      { update_id: 10, message: { message_id: 1, chat: { id: 1 }, text: '/start' } },
      { update_id: 11, message: { message_id: 2, chat: { id: 1 }, text: '/pair code' } },
    ];
    const getUpdates = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary_network_error'))
      .mockResolvedValueOnce(updates);
    const handle = vi.fn(async (update: TelegramUpdate) => {
      if (update.update_id === 10) throw new Error('access_denied');
      controller.abort();
    });
    const errors = vi.fn();

    await pollTelegram(
      { getUpdates } as unknown as TelegramApiClient,
      handle,
      controller.signal,
      errors,
      0,
    );

    expect(getUpdates).toHaveBeenCalledTimes(2);
    expect(handle).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledTimes(2);
  });
});
