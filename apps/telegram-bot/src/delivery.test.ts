import { describe, expect, it, vi } from 'vitest';
import {
  splitTelegramText,
  TelegramArtifactDelivery,
  TelegramNotificationGate,
} from './delivery.js';

describe('Telegram delivery safety', () => {
  it('chunks Unicode text within Telegram byte limits', () => {
    const chunks = splitTelegramText('🙂'.repeat(3_000), 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => Buffer.byteLength(chunk) <= 100)).toBe(true);
    expect(chunks.join('')).toBe('🙂'.repeat(3_000));
  });

  it('redacts authorized logs and denies secrets or unauthorized artifacts', async () => {
    const save = vi.fn();
    const delivery = new TelegramArtifactDelivery({ save }, ['CANARY']);
    expect(
      delivery
        .text({
          kind: 'TERMINAL_LOG',
          classification: 'LOCAL_ONLY',
          content: 'token=abc CANARY',
          authorized: true,
        })
        .join(''),
    ).not.toContain('CANARY');
    expect(() =>
      delivery.text({
        kind: 'SECRET_VALUE',
        classification: 'SECRET',
        content: 'x',
        authorized: true,
      }),
    ).toThrow('secret_artifact_forbidden');
    await expect(
      delivery.attachment({
        id: '1',
        fileName: 'x.zip',
        mimeType: 'application/zip',
        bytes: new Uint8Array(),
        classification: 'LOCAL_ONLY',
        authorized: false,
        retentionMs: 60_000,
      }),
    ).rejects.toThrow('telegram_artifact_not_authorized');
    expect(save).not.toHaveBeenCalled();
  });

  it('applies SILENT, NORMAL, VERBOSE and rate limits without hiding security alerts', () => {
    const gate = new TelegramNotificationGate(() => 1_000, 1);
    expect(gate.allow(1, 'SILENT', 'ROUTINE')).toBe(false);
    expect(gate.allow(1, 'NORMAL', 'ROUTINE')).toBe(false);
    expect(gate.allow(1, 'VERBOSE', 'ROUTINE')).toBe(true);
    expect(gate.allow(1, 'VERBOSE', 'IMPORTANT')).toBe(false);
    expect(gate.allow(1, 'SILENT', 'SECURITY')).toBe(true);
  });
});
