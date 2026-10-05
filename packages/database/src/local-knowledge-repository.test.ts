import { describe, expect, it, vi } from 'vitest';
import {
  LocalKnowledgeRepository,
  validateKnowledgeScope,
  type KnowledgeScope,
} from './local-knowledge-repository.js';
import type { SqlClient } from './sql.js';

describe('knowledge scope validation', () => {
  it('accepts the local knowledge scopes required by phase 16', () => {
    expect(validateKnowledgeScope('SESSION')).toBe('SESSION');
    expect(validateKnowledgeScope('MISSION')).toBe('MISSION');
    expect(validateKnowledgeScope('PROJECT')).toBe('PROJECT');
    expect(validateKnowledgeScope('USER_PREFERENCE')).toBe('USER_PREFERENCE');
    expect(() => validateKnowledgeScope('INVALID' as KnowledgeScope)).toThrow(
      'Unsupported knowledge scope',
    );
  });
});

describe('LocalKnowledgeRepository', () => {
  it('creates a project-scoped memory entry with the expected provenance fields', async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          public_id: 'entry-1',
          scope: 'PROJECT',
          content_key: 'readme-summary',
          value: { summary: 'ok' },
          freshness_status: 'FRESH',
          source_path: 'README.md',
          sha256: 'a'.repeat(64),
          version: 1,
          classification: 'LOCAL_ONLY',
        },
      ],
    });

    const repository = new LocalKnowledgeRepository({ query } as unknown as SqlClient);

    await repository.createEntry({
      projectPublicId: 'project-1',
      sourcePublicId: 'source-1',
      scope: 'PROJECT',
      key: 'readme-summary',
      value: { summary: 'ok' },
      classification: 'LOCAL_ONLY',
      sha256: 'a'.repeat(64),
      version: 1,
      sourcePath: 'README.md',
      sourceHash: 'b'.repeat(64),
      freshnessStatus: 'FRESH',
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('insert into memory_entries'),
      expect.arrayContaining([
        'project-1',
        'source-1',
        'PROJECT',
        'readme-summary',
        'LOCAL_ONLY',
        'a'.repeat(64),
        1,
      ]),
    );
  });

  it('marks an entry stale without dropping provenance metadata', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const repository = new LocalKnowledgeRepository({ query } as unknown as SqlClient);

    await repository.markStale('entry-1');

    expect(query).toHaveBeenCalledWith(expect.stringContaining('freshness_status = $2'), [
      'entry-1',
      'STALE',
    ]);
  });

  it('versions preference corrections with optimistic concurrency', async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          public_id: 'entry-2',
          scope: 'USER_PREFERENCE',
          content_key: 'language',
          value: { language: 'fr' },
          classification: 'LOCAL_ONLY',
          sha256: 'a'.repeat(64),
          version: 2,
          freshness_status: 'FRESH',
        },
      ],
    });
    const repository = new LocalKnowledgeRepository({ query } as unknown as SqlClient);
    await expect(
      repository.correctPreference({
        userPublicId: 'user-1',
        key: 'language',
        value: { language: 'fr' },
        sha256: 'a'.repeat(64),
        expectedVersion: 1,
      }),
    ).resolves.toMatchObject({
      key: 'language',
      version: 2,
    });
    expect(query.mock.calls[0]?.[0]).toContain('coalesce((select version from latest),0) = $5');
  });
});
