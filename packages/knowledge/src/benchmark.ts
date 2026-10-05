import { memoryUsage } from 'node:process';
import { performance } from 'node:perf_hooks';

export interface KnowledgeBenchmarkResult {
  readonly corpusFiles: number;
  readonly corpusBytes: number;
  readonly chunks: number;
  readonly embeddingDimension: number;
  readonly indexingMs: number;
  readonly searchP95Ms: number;
  readonly rssDeltaBytes: number;
  readonly estimatedDiskBytes: number;
}

export class KnowledgeBenchmark {
  constructor(
    private readonly clock: () => number = () => performance.now(),
    private readonly rss: () => number = () => memoryUsage().rss,
  ) {}

  async run(input: {
    readonly corpusFiles: number;
    readonly corpusBytes: number;
    readonly embeddingDimension: number;
    readonly index: () => Promise<Readonly<{ chunks: number; estimatedDiskBytes: number }>>;
    readonly searches: readonly (() => Promise<void>)[];
  }): Promise<KnowledgeBenchmarkResult> {
    if (input.corpusFiles < 1 || input.corpusBytes < 1 || input.searches.length < 5) {
      throw new Error('invalid_benchmark_corpus');
    }
    const rssBefore = this.rss();
    const indexStarted = this.clock();
    const indexed = await input.index();
    const indexingMs = this.clock() - indexStarted;
    const latencies: number[] = [];
    for (const search of input.searches) {
      const started = this.clock();
      await search();
      latencies.push(this.clock() - started);
    }
    latencies.sort((left, right) => left - right);
    const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1] ?? 0;
    return {
      corpusFiles: input.corpusFiles,
      corpusBytes: input.corpusBytes,
      chunks: indexed.chunks,
      embeddingDimension: input.embeddingDimension,
      indexingMs: Math.round(indexingMs * 1_000) / 1_000,
      searchP95Ms: Math.round(p95 * 1_000) / 1_000,
      rssDeltaBytes: Math.max(0, this.rss() - rssBefore),
      estimatedDiskBytes: indexed.estimatedDiskBytes,
    };
  }
}
