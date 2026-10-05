import { describe, expect, it, vi } from 'vitest';
import { SchedulerAdministrationService } from './administration.js';
describe('scheduler administration', () => {
  it('requires strong one-use authorization for AUTONOMOUS and restores EXECUTE_SAFE', async () => {
    const store = {
      setGlobalPause: vi.fn(async () => 1),
      setAutonomy: vi.fn(async () => undefined),
      schedule: vi.fn(async () => ({})),
      diagnostics: vi.fn(async () => ({})),
    };
    const authorizations = { consume: vi.fn(async () => true) };
    const audit = { record: vi.fn(async () => undefined) };
    const signals = { cancelAll: vi.fn(async () => 2) };
    const service = new SchedulerAdministrationService(store, authorizations, audit, signals);
    await expect(service.pause()).resolves.toBe(1);
    expect(signals.cancelAll).toHaveBeenCalledWith('scheduler_global_pause');
    await service.elevate('AUTONOMOUS', 'preview-hash', 'pin-ref');
    expect(authorizations.consume).toHaveBeenCalledTimes(1);
    await service.restoreSafe();
    expect(store.setAutonomy).toHaveBeenLastCalledWith('EXECUTE_SAFE');
    for (const command of ['CREATE', 'PAUSE', 'RESUME', 'RUN_NOW', 'DELETE'] as const)
      await service.manage(command, 'schedule-1');
    await service.manage('LIST');
    expect(store.schedule).toHaveBeenCalledTimes(6);
    await expect(service.diagnostics()).resolves.toEqual({});
  });
});
