import { describe, expect, it, vi } from 'vitest';
import { HybridKnowledgeSearch, type LexicalCandidate } from './search.js';

const candidate = (overrides: Partial<LexicalCandidate> = {}): LexicalCandidate => ({
  chunkId: 'chunk-1',
  sourceId: 'source-1',
  projectId: 'project-1',
  relativePath: 'docs/guide.md',
  section: 'Setup',
  anchor: 'setup',
  sourceHash: 'a'.repeat(64),
  chunkHash: 'b'.repeat(64),
  version: 2,
  observedAt: '2026-10-01T00:00:00.000Z',
  freshness: 'FRESH',
  excerpt: 'Verified local setup instructions',
  lexicalScore: 0.5,
  ...overrides,
});

describe('HybridKnowledgeSearch', () => {
  it('combines lexical and semantic scores deterministically with resolvable citations', async () => {
    const item = candidate();
    const store = {
      lexical: vi.fn(async () => [item]),
      citation: vi.fn(async () => item),
    };
    const search = new HybridKnowledgeSearch(store, {
      destination: 'LOCAL_MODEL',
      search: vi.fn(async (input) => {
        expect(input.classification).toBe('LOCAL_ONLY');
        return [{ chunkId: 'chunk-1', score: 1 }];
      }),
    });
    const response = await search.search({
      projectId: 'project-1',
      query: 'setup',
      semanticModel: 'local-embed',
      semanticDimension: 384,
    });
    expect(response).toMatchObject({
      mode: 'HYBRID',
      results: [{ score: 0.7, partial: false, trust: 'DATA_ONLY' }],
    });
    const uri = response.results[0]!.citation.uri;
    await expect(search.getCitation(uri)).resolves.toMatchObject({ relativePath: 'docs/guide.md' });
  });

  it('degrades to lexical-only without invoking any cloud fallback', async () => {
    const semantic = {
      destination: 'LOCAL_MODEL' as const,
      search: vi.fn(async () => Promise.reject(new Error('local unavailable'))),
    };
    const search = new HybridKnowledgeSearch(
      { lexical: vi.fn(async () => [candidate()]), citation: vi.fn() },
      semantic,
    );
    await expect(
      search.search({
        projectId: 'project-1',
        query: 'setup',
        semanticModel: 'local-only',
        semanticDimension: 2,
      }),
    ).resolves.toMatchObject({ mode: 'LEXICAL_ONLY', results: [{ partial: true, score: 0.5 }] });
    expect(semantic.search).toHaveBeenCalledOnce();
  });

  it('blocks a cloud semantic adapter before any query or excerpt can leave the PC', () => {
    const cloud = { destination: 'OPENAI', search: vi.fn() };
    expect(
      () => new HybridKnowledgeSearch({ lexical: vi.fn(), citation: vi.fn() }, cloud as never),
    ).toThrow('cloud_semantic_forbidden');
    expect(cloud.search).not.toHaveBeenCalled();
  });

  it('revalidates critical results and excludes stale or changed evidence', async () => {
    const search = new HybridKnowledgeSearch(
      { lexical: vi.fn(async () => [candidate()]), citation: vi.fn() },
      undefined,
      { revalidate: vi.fn(async () => false) },
    );
    await expect(
      search.search({ projectId: 'project-1', query: 'critical fact', critical: true }),
    ).resolves.toEqual({ mode: 'LEXICAL_ONLY', results: [] });
  });
});
