import { describe, expect, it, vi } from 'vitest';
import {
  LocalEmbeddingError,
  LocalEmbeddingService,
  LocalSemanticSearchService,
} from './embedding.js';

describe('LocalEmbeddingService', () => {
  it('uses only the exact local model and namespaces vectors by model and dimension', async () => {
    const embed = vi.fn(async () => ({ model: 'local-embed-v1', vectors: [[0.1, 0.2]] }));
    const service = new LocalEmbeddingService({ destination: 'LOCAL_MODEL', embed });
    await expect(
      service.embed({
        model: 'local-embed-v1',
        dimension: 2,
        chunks: [{ id: 'chunk-1', content: 'local project memory' }],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        chunkId: 'chunk-1',
        namespace: 'local-embed-v1:2',
        dimension: 2,
      }),
    ]);
    expect(embed).toHaveBeenCalledWith(
      expect.objectContaining({ classification: 'LOCAL_ONLY', model: 'local-embed-v1' }),
    );
  });

  it('rejects cloud adapters, model substitution and malformed vectors', async () => {
    const cloud = { destination: 'OPENAI', embed: vi.fn() };
    expect(() => new LocalEmbeddingService(cloud as never)).toThrowError(LocalEmbeddingError);
    expect(cloud.embed).not.toHaveBeenCalled();

    const service = new LocalEmbeddingService({
      destination: 'LOCAL_MODEL',
      embed: vi.fn(async () => ({ model: 'other-model', vectors: [[1]] })),
    });
    await expect(
      service.embed({ model: 'expected', dimension: 1, chunks: [{ id: 'c', content: 'x' }] }),
    ).rejects.toMatchObject({ reason: 'model_substitution' });
  });

  it('ranks persisted vectors locally with cosine similarity', async () => {
    const service = new LocalEmbeddingService({
      destination: 'LOCAL_MODEL',
      embed: vi.fn(async () => ({ model: 'local', vectors: [[1, 0]] })),
    });
    const search = new LocalSemanticSearchService(service, {
      load: vi.fn(async () => [
        { chunkId: 'near', vector: [0.9, 0.1] },
        { chunkId: 'far', vector: [0, 1] },
      ]),
    });
    await expect(
      search.search({
        projectId: 'p',
        query: 'q',
        classification: 'LOCAL_ONLY',
        model: 'local',
        dimension: 2,
        limit: 2,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ chunkId: 'near' }),
      expect.objectContaining({ chunkId: 'far', score: 0 }),
    ]);
  });
});
