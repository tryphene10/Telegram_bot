import { dueOccurrences, nextOccurrence } from './time.js';
import type { ScheduleDefinition } from './types.js';
import type { SchedulerWorker } from './worker.js';
export interface SchedulerRuntimeStore {
  recoverExpired(): Promise<number>;
  dueSchedules(now: string): Promise<readonly ScheduleDefinition[]>;
  materialize(
    scheduleId: string,
    occurrences: readonly { readonly key: string; readonly dueAt: string }[],
  ): Promise<number>;
  advanceSchedule(scheduleId: string, nextRunAt: string | undefined): Promise<void>;
}
export interface SchedulerRuntimeAuditPort {
  record(event: Readonly<Record<string, unknown>>): Promise<void>;
}
export class SchedulerRuntime {
  constructor(
    private readonly store: SchedulerRuntimeStore,
    private readonly worker: SchedulerWorker,
    private readonly audit: SchedulerRuntimeAuditPort,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  async restore(): Promise<number> {
    const recovered = await this.store.recoverExpired();
    await this.audit.record({ event: 'SCHEDULER_RESTORED', recovered });
    return recovered;
  }
  async runCycle(): Promise<{ materialized: number; worker: string }> {
    const now = this.clock();
    let materialized = 0;
    for (const schedule of await this.store.dueSchedules(now.toISOString())) {
      const occurrences = dueOccurrences(schedule, now);
      materialized += await this.store.materialize(schedule.id, occurrences);
      const next = nextOccurrence(schedule, now);
      await this.store.advanceSchedule(schedule.id, next?.toISOString());
    }
    const worker = await this.worker.runOnce();
    return { materialized, worker };
  }
  async run(signal: AbortSignal, intervalMs = 1000): Promise<void> {
    await this.restore();
    while (!signal.aborted) {
      await this.runCycle();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, intervalMs);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  }
}
