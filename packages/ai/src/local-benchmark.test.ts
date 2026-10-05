import { describe, expect, it, vi } from 'vitest';
import { benchmarkLocalRuntime } from './local-benchmark.js';

describe('local runtime benchmark', () => {
  it('accepts a local runtime only when latency, throughput and memory fit', async () => {
    const run = vi.fn(async () => ({
      firstTokenMs: 800,
      totalLatencyMs: 2_000,
      inputTokens: 10,
      outputTokens: 20,
      peakWorkingSetBytes: 8 * 1024 ** 3,
    }));
    await expect(
      benchmarkLocalRuntime(
        { run },
        {
          samples: 3,
          maximumFirstTokenMs: 2_000,
          minimumTokensPerSecond: 5,
          maximumWorkingSetBytes: 16 * 1024 ** 3,
        },
      ),
    ).resolves.toMatchObject({ accepted: true, samples: 3, medianTokensPerSecond: 10 });
  });

  it('reports every exceeded hardware constraint', async () => {
    const report = await benchmarkLocalRuntime(
      {
        run: async () => ({
          firstTokenMs: 5_000,
          totalLatencyMs: 10_000,
          inputTokens: 10,
          outputTokens: 10,
          peakWorkingSetBytes: 20 * 1024 ** 3,
        }),
      },
      {
        samples: 1,
        maximumFirstTokenMs: 2_000,
        minimumTokensPerSecond: 2,
        maximumWorkingSetBytes: 16 * 1024 ** 3,
      },
    );
    expect(report).toMatchObject({ accepted: false });
    expect(report.reasons).toEqual([
      'first_token_too_slow',
      'generation_too_slow',
      'working_set_too_large',
    ]);
  });
});
