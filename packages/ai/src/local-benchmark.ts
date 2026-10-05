export interface LocalBenchmarkSample {
  readonly firstTokenMs: number;
  readonly totalLatencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly peakWorkingSetBytes: number;
}

export interface LocalRuntimeProbe {
  run(): Promise<LocalBenchmarkSample>;
}

export interface LocalBenchmarkReport {
  readonly samples: number;
  readonly medianFirstTokenMs: number;
  readonly medianTokensPerSecond: number;
  readonly peakWorkingSetBytes: number;
  readonly accepted: boolean;
  readonly reasons: readonly string[];
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted[middle];
  if (value === undefined) throw new Error('benchmark_samples_required');
  if (sorted.length % 2 === 1) return value;
  return ((sorted[middle - 1] ?? value) + value) / 2;
}

export async function benchmarkLocalRuntime(
  probe: LocalRuntimeProbe,
  constraints: {
    readonly samples?: number;
    readonly maximumFirstTokenMs: number;
    readonly minimumTokensPerSecond: number;
    readonly maximumWorkingSetBytes: number;
  },
): Promise<LocalBenchmarkReport> {
  const count = constraints.samples ?? 3;
  if (!Number.isSafeInteger(count) || count < 1 || count > 20) {
    throw new Error('invalid_benchmark_sample_count');
  }
  const samples: LocalBenchmarkSample[] = [];
  for (let index = 0; index < count; index += 1) samples.push(await probe.run());
  const firstToken = median(samples.map(({ firstTokenMs }) => firstTokenMs));
  const throughput = median(
    samples.map(({ outputTokens, totalLatencyMs }) =>
      totalLatencyMs > 0 ? outputTokens / (totalLatencyMs / 1_000) : 0,
    ),
  );
  const peak = Math.max(...samples.map(({ peakWorkingSetBytes }) => peakWorkingSetBytes));
  const reasons = [
    ...(firstToken > constraints.maximumFirstTokenMs ? ['first_token_too_slow'] : []),
    ...(throughput < constraints.minimumTokensPerSecond ? ['generation_too_slow'] : []),
    ...(peak > constraints.maximumWorkingSetBytes ? ['working_set_too_large'] : []),
  ];
  return {
    samples: count,
    medianFirstTokenMs: firstToken,
    medianTokensPerSecond: throughput,
    peakWorkingSetBytes: peak,
    accepted: reasons.length === 0,
    reasons,
  };
}
