import { describe, expect, it, vi } from 'vitest';
import { evaluateMonitor, MonitorRunner, sanitizeSample } from './monitoring.js';
const definition = {
  id: 'mon1',
  type: 'HTTP' as const,
  target: { url: 'http://127.0.0.1' },
  failureThreshold: 3,
  recoveryThreshold: 2,
  windowSize: 5,
};
describe('monitoring hysteresis', () => {
  it('opens and resolves only beyond hysteresis thresholds', () => {
    expect(
      evaluateMonitor(definition, [{ available: false }], { available: false }).transition,
    ).toBe('NONE');
    expect(
      evaluateMonitor(definition, [{ available: false }, { available: false }], {
        available: false,
      }).transition,
    ).toBe('OPEN');
    const incident = {
      id: 'i1',
      status: 'OPEN' as const,
      consecutiveFailures: 3,
      consecutiveSuccesses: 0,
    };
    expect(
      evaluateMonitor(definition, [{ available: false }], { available: true }, incident).transition,
    ).toBe('NONE');
    expect(
      evaluateMonitor(definition, [{ available: true }], { available: true }, incident).transition,
    ).toBe('RESOLVE');
  });
  it('reopens a resolved incident and sanitizes samples', () => {
    const resolved = {
      id: 'i1',
      status: 'RESOLVED' as const,
      consecutiveFailures: 0,
      consecutiveSuccesses: 2,
    };
    expect(
      evaluateMonitor(
        definition,
        [{ available: false }, { available: false }],
        { available: false },
        resolved,
      ).transition,
    ).toBe('REOPEN');
    expect(
      sanitizeSample({
        available: false,
        errorCode: 'token=secret connection refused',
        latencyMs: -4,
      }),
    ).toEqual({ available: false, errorCode: 'token_secret_connection_refused', latencyMs: 0 });
  });
  it('persists a sample and its incident transition', async () => {
    const store = {
      recent: vi.fn(async () => [{ available: false }, { available: false }]),
      saveSample: vi.fn(async () => undefined),
      activeIncident: vi.fn(async () => undefined),
      transition: vi.fn(async () => undefined),
    };
    await expect(
      new MonitorRunner(
        { sample: vi.fn(async () => ({ available: false, errorCode: 'ECONNREFUSED' })) },
        store,
      ).run(definition),
    ).resolves.toMatchObject({ transition: 'OPEN' });
    expect(store.transition).toHaveBeenCalledTimes(1);
  });
});
