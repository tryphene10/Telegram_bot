export type MonitorType = 'HTTP' | 'PROCESS' | 'TCP' | 'SERVICE';
export interface MonitorDefinition {
  readonly id: string;
  readonly type: MonitorType;
  readonly target: Readonly<Record<string, unknown>>;
  readonly failureThreshold: number;
  readonly recoveryThreshold: number;
  readonly windowSize: number;
}
export interface MonitorSample {
  readonly available: boolean;
  readonly latencyMs?: number;
  readonly statusCode?: number;
  readonly errorCode?: string;
}
export interface IncidentSnapshot {
  readonly id: string;
  readonly status: 'OPEN' | 'ACKNOWLEDGED' | 'INVESTIGATING' | 'RESOLVED' | 'IGNORED';
  readonly consecutiveFailures: number;
  readonly consecutiveSuccesses: number;
}
export interface MonitorEvaluation {
  readonly transition: 'NONE' | 'OPEN' | 'UPDATE' | 'RESOLVE' | 'REOPEN';
  readonly failures: number;
  readonly successes: number;
}
export interface MonitorProbePort {
  sample(definition: MonitorDefinition): Promise<MonitorSample>;
}
export interface MonitoringStore {
  recent(monitorId: string, limit: number): Promise<readonly MonitorSample[]>;
  saveSample(monitorId: string, sample: MonitorSample): Promise<void>;
  activeIncident(monitorId: string): Promise<IncidentSnapshot | undefined>;
  transition(
    monitorId: string,
    evaluation: MonitorEvaluation,
    sample: MonitorSample,
  ): Promise<void>;
}

export function sanitizeSample(sample: MonitorSample): MonitorSample {
  return {
    available: sample.available,
    ...(sample.latencyMs === undefined
      ? {}
      : { latencyMs: Math.max(0, Math.round(sample.latencyMs)) }),
    ...(sample.statusCode === undefined ? {} : { statusCode: sample.statusCode }),
    ...(sample.errorCode
      ? { errorCode: sample.errorCode.replace(/[^A-Z0-9_.:-]/giu, '_').slice(0, 128) }
      : {}),
  };
}
export function evaluateMonitor(
  definition: MonitorDefinition,
  history: readonly MonitorSample[],
  current: MonitorSample,
  incident?: IncidentSnapshot,
): MonitorEvaluation {
  const samples = [...history, current].slice(-definition.windowSize);
  let failures = 0;
  for (let index = samples.length - 1; index >= 0 && !samples[index]?.available; index -= 1)
    failures += 1;
  let successes = 0;
  for (let index = samples.length - 1; index >= 0 && samples[index]?.available; index -= 1)
    successes += 1;
  const active = incident && ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING'].includes(incident.status);
  if (!current.available && failures >= definition.failureThreshold)
    return {
      transition: active ? 'UPDATE' : incident?.status === 'RESOLVED' ? 'REOPEN' : 'OPEN',
      failures,
      successes,
    };
  if (current.available && active && successes >= definition.recoveryThreshold)
    return { transition: 'RESOLVE', failures, successes };
  return { transition: 'NONE', failures, successes };
}
export class MonitorRunner {
  constructor(
    private readonly probe: MonitorProbePort,
    private readonly store: MonitoringStore,
  ) {}
  async run(definition: MonitorDefinition): Promise<MonitorEvaluation> {
    const sample = sanitizeSample(await this.probe.sample(definition));
    const [history, incident] = await Promise.all([
      this.store.recent(definition.id, definition.windowSize - 1),
      this.store.activeIncident(definition.id),
    ]);
    await this.store.saveSample(definition.id, sample);
    const evaluation = evaluateMonitor(definition, history, sample, incident);
    if (evaluation.transition !== 'NONE')
      await this.store.transition(definition.id, evaluation, sample);
    return evaluation;
  }
}
