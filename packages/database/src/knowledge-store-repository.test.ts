import { describe, expect, it, vi } from 'vitest';
import { KnowledgeStoreRepository } from './knowledge-store-repository.js';
import type { SqlClient } from './sql.js';

describe('KnowledgeStoreRepository', () => {
  it('upserts a source and chunks idempotently in one statement', async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [{ source_id: 'source-1', inserted: false, chunk_count: '2' }],
    });
    const repository = new KnowledgeStoreRepository({ query } as unknown as SqlClient);
    await expect(
      repository.upsert({
        source: {
          projectId: 'project-1',
          sourceType: 'MARKDOWN',
          relativePath: 'docs/a.md',
          title: 'A',
          sha256: 'a'.repeat(64),
          version: 1,
          sizeBytes: 10,
          modifiedAt: '2026-10-01T00:00:00Z',
          observedAt: '2026-10-01T00:00:01Z',
        },
        chunks: [
          {
            ordinal: 0,
            section: 'A',
            anchor: 'a',
            startOffset: 0,
            endOffset: 10,
            content: 'knowledge',
            sha256: 'b'.repeat(64),
          },
        ],
        searchConfig: 'simple',
      }),
    ).resolves.toEqual({ sourceId: 'source-1', inserted: false, chunks: 2 });
    expect(query.mock.calls[0]?.[0]).toContain(
      'on conflict (project_id,relative_path,sha256,version) do nothing',
    );
  });

  it('bounds lexical search in PostgreSQL and keeps provenance', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const repository = new KnowledgeStoreRepository({ query } as unknown as SqlClient);
    await repository.lexical({
      projectId: 'project-1',
      query: 'setup',
      searchConfig: 'simple',
      limit: 10,
      excerptCharacters: 500,
      timeoutMs: 1000,
    });
    expect(query.mock.calls[0]?.[0]).toContain("set_config('statement_timeout'");
    expect(query.mock.calls[0]?.[0]).toContain('source_hash');
    expect(query.mock.calls[0]?.[1]).toContain('1000ms');
  });

  it('recovers jobs without duplication and returns an irreversible purge report', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 2, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            sources: '1',
            chunks: '2',
            embeddings: '2',
            entries: '1',
            jobs: '1',
            tombstone_id: 't-1',
          },
        ],
      });
    const repository = new KnowledgeStoreRepository({ query } as unknown as SqlClient);
    await expect(repository.recoverExpired()).resolves.toBe(2);
    expect(query.mock.calls[0]?.[0]).toContain('SOURCE_ORPHANED');
    await expect(repository.purgeProject('project-1', 'user_confirmed')).resolves.toMatchObject({
      sources: 1,
      chunks: 2,
      embeddings: 2,
      entries: 1,
      jobs: 1,
      tombstoneId: 't-1',
      purgeDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(query.mock.calls[1]?.[0]).toContain('memory_tombstones');
  });
});
