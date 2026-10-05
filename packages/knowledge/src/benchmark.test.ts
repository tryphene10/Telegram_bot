import { describe, expect, it, vi } from 'vitest';
import { KnowledgeBenchmark } from './benchmark.js';

describe('KnowledgeBenchmark', () => {
  it('reports indexing, RAM, disk and p95 search latency', async () => {
    const times = [0, 20, 21, 23, 24, 27, 28, 32, 33, 38, 39, 45];
    const rss = [1000, 1400];
    const benchmark = new KnowledgeBenchmark(
      () => times.shift() ?? 45,
      () => rss.shift() ?? 1400,
    );
    const report = await benchmark.run({
      corpusFiles: 2,
      corpusBytes: 1000,
      embeddingDimension: 2,
      index: vi.fn(async () => ({ chunks: 4, estimatedDiskBytes: 2400 })),
      searches: Array.from({ length: 5 }, () => vi.fn(async () => undefined)),
    });
    expect(report).toMatchObject({
      chunks: 4,
      indexingMs: 20,
      searchP95Ms: 6,
      rssDeltaBytes: 400,
      estimatedDiskBytes: 2400,
    });
  });
});
