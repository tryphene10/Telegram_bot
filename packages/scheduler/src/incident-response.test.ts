import { describe, expect, it, vi } from 'vitest';
import { IncidentResponseService } from './incident-response.js';
describe('incident response', () => {
  it('routes investigation through policy and Supervisor', async () => {
    const store = {
      load: vi.fn(async () => ({
        id: 'i1',
        actionHash: 'old',
        sensitive: false,
        environment: 'LOCAL' as const,
        restartCount: 0,
        maxRestarts: 1,
      })),
      transition: vi.fn(async () => undefined),
    };
    const policy = {
      evaluate: vi.fn(async () => ({
        decision: 'ALLOW' as const,
        reason: 'ok',
        explanation: '',
        actionHash: 'fresh',
      })),
    };
    const supervisor = {
      investigate: vi.fn(async () => ({ report: 'safe' })),
      restart: vi.fn(async () => ({ restarted: true })),
    };
    await expect(
      new IncidentResponseService(store, policy, supervisor, {
        consume: vi.fn(async () => false),
      }).respond('i1', 'INVESTIGATE'),
    ).resolves.toEqual({ report: 'safe' });
    expect(supervisor.investigate).toHaveBeenCalledWith('i1');
  });
  it('requires a fresh strong approval and enforces restart limits', async () => {
    const store = {
      load: vi.fn(async () => ({
        id: 'i1',
        actionHash: 'old',
        sensitive: true,
        environment: 'PRODUCTION' as const,
        restartCount: 0,
        maxRestarts: 1,
      })),
      transition: vi.fn(async () => undefined),
    };
    const policy = {
      evaluate: vi.fn(async () => ({
        decision: 'REQUIRE_STRONG_APPROVAL' as const,
        reason: 'production',
        explanation: '',
        actionHash: 'fresh',
      })),
    };
    const supervisor = {
      investigate: vi.fn(async () => ({})),
      restart: vi.fn(async () => ({ restarted: true })),
    };
    const auth = { consume: vi.fn(async () => true) };
    const service = new IncidentResponseService(store, policy, supervisor, auth);
    await expect(service.respond('i1', 'RESTART')).rejects.toThrow(
      'strong_fresh_approval_required',
    );
    await expect(service.respond('i1', 'RESTART', 'once')).resolves.toEqual({ restarted: true });
    expect(auth.consume).toHaveBeenCalledWith(expect.objectContaining({ actionHash: 'fresh' }));
    store.load.mockResolvedValueOnce({
      id: 'i1',
      actionHash: 'old',
      sensitive: true,
      environment: 'PRODUCTION',
      restartCount: 1,
      maxRestarts: 1,
    });
    await expect(service.respond('i1', 'RESTART', 'once2')).rejects.toThrow(
      'restart_limit_reached',
    );
  });
});
