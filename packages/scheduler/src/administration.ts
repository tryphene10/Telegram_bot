import type { AutonomyLevel } from './types.js';
export interface SchedulerAdministrationStore {
  setGlobalPause(paused: boolean): Promise<number>;
  setAutonomy(level: AutonomyLevel): Promise<void>;
  schedule(
    command: 'CREATE' | 'LIST' | 'PAUSE' | 'RESUME' | 'RUN_NOW' | 'DELETE',
    argument?: string,
  ): Promise<Readonly<Record<string, unknown>>>;
  diagnostics(): Promise<Readonly<Record<string, unknown>>>;
}
export interface StrongAutonomyAuthorizationPort {
  consume(input: {
    readonly level: AutonomyLevel;
    readonly previewHash: string;
    readonly authorizationReference: string;
  }): Promise<boolean>;
}
export interface SchedulerAdministrationAuditPort {
  record(event: Readonly<Record<string, unknown>>): Promise<void>;
}
export interface SchedulerActiveSignalPort {
  cancelAll(reason: string): Promise<number>;
}
export class SchedulerAdministrationError extends Error {
  constructor(readonly reason: string) {
    super(`Scheduler administration rejected: ${reason}`);
    this.name = 'SchedulerAdministrationError';
  }
}
export class SchedulerAdministrationService {
  constructor(
    private readonly store: SchedulerAdministrationStore,
    private readonly authorizations: StrongAutonomyAuthorizationPort,
    private readonly audit: SchedulerAdministrationAuditPort,
    private readonly signals: SchedulerActiveSignalPort,
  ) {}
  async pause(): Promise<number> {
    const generation = await this.store.setGlobalPause(true);
    const cancelledSignals = await this.signals.cancelAll('scheduler_global_pause');
    await this.audit.record({ event: 'SCHEDULER_GLOBAL_PAUSED', generation, cancelledSignals });
    return generation;
  }
  async resume(): Promise<number> {
    const generation = await this.store.setGlobalPause(false);
    await this.audit.record({ event: 'SCHEDULER_GLOBAL_RESUMED', generation });
    return generation;
  }
  async elevate(
    level: AutonomyLevel,
    previewHash: string,
    authorizationReference: string,
  ): Promise<void> {
    if (level === 'OBSERVE' || level === 'ASSIST' || level === 'EXECUTE_SAFE')
      throw new SchedulerAdministrationError('elevation_target_must_be_autonomous');
    if (!(await this.authorizations.consume({ level, previewHash, authorizationReference })))
      throw new SchedulerAdministrationError('pin_and_exact_preview_required');
    await this.store.setAutonomy(level);
    await this.audit.record({ event: 'SCHEDULER_AUTONOMY_ELEVATED', level, previewHash });
  }
  async restoreSafe(): Promise<void> {
    await this.store.setAutonomy('EXECUTE_SAFE');
    await this.audit.record({ event: 'SCHEDULER_AUTONOMY_RESTORED_SAFE' });
  }
  async manage(
    command: 'CREATE' | 'LIST' | 'PAUSE' | 'RESUME' | 'RUN_NOW' | 'DELETE',
    argument?: string,
  ) {
    if (command !== 'LIST' && !argument?.trim())
      throw new SchedulerAdministrationError('schedule_reference_required');
    const result = await this.store.schedule(command, argument?.trim());
    await this.audit.record({ event: `SCHEDULE_${command}`, argument: argument?.trim(), result });
    return result;
  }
  async diagnostics() {
    const result = await this.store.diagnostics();
    await this.audit.record({ event: 'SCHEDULER_DIAGNOSTICS_READ' });
    return result;
  }
}
