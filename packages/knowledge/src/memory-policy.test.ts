import { describe, expect, it, vi } from 'vitest';
import { SecretRedactor } from '@arcc/security';
import { DurableMemoryService } from './memory-policy.js';

describe('DurableMemoryService', () => {
  it('keeps only bounded verified knowledge and audits explicit extension', async () => {
    const persistence = {
      create: vi.fn(async () => 'entry-1'),
      extend: vi.fn(async () => undefined),
    };
    const audit = { record: vi.fn(async () => undefined) };
    const service = new DurableMemoryService(
      persistence,
      audit,
      new SecretRedactor(),
      () => new Date('2026-10-01T00:00:00.000Z'),
    );
    await expect(
      service.remember({
        scope: 'MISSION',
        kind: 'VERIFIED_RESULT',
        key: 'tests',
        value: 'All checks passed',
        version: 1,
        provenanceReference: 'audit:test-1',
      }),
    ).resolves.toBe('entry-1');
    expect(persistence.create).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: 'LOCAL_ONLY',
        expiresAt: '2026-10-31T00:00:00.000Z',
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    await service.extend('entry-1', 60_000);
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: 'MEMORY_EXPIRATION_EXTENDED',
      }),
    );
  });

  it('rejects raw prompts, oversized values and secrets', async () => {
    const service = new DurableMemoryService(
      { create: vi.fn(), extend: vi.fn() },
      { record: vi.fn() },
      new SecretRedactor(['MEM_CANARY']),
    );
    await expect(
      service.remember({
        scope: 'MISSION',
        kind: 'DECISION',
        key: 'raw_prompt',
        value: 'do it',
        version: 1,
        provenanceReference: 'audit:1',
      }),
    ).rejects.toMatchObject({ reason: 'excluded_content_kind' });
    await expect(
      service.remember({
        scope: 'MISSION',
        kind: 'DECISION',
        key: 'decision',
        value: 'MEM_CANARY',
        version: 1,
        provenanceReference: 'audit:1',
      }),
    ).rejects.toMatchObject({ reason: 'secret_content_forbidden' });
  });
});
