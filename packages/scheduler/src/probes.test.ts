import { describe, expect, it, vi } from 'vitest';
import { LocalMonitorProbeAdapter } from './probes.js';
const definition = (
  type: 'HTTP' | 'PROCESS' | 'TCP' | 'SERVICE',
  target: Readonly<Record<string, unknown>>,
) => ({ id: 'm1', type, target, failureThreshold: 3, recoveryThreshold: 2, windowSize: 5 });
describe('local monitor probes', () => {
  const http = {
    authorize: vi.fn(async () => true),
    probe: vi.fn(async () => ({ statusCode: 200, latencyMs: 12 })),
  };
  const windows = {
    process: vi.fn(async () => true),
    service: vi.fn(async () => true),
    tcp: vi.fn(async () => ({ available: true, latencyMs: 3 })),
  };
  it('supports authorized HTTP, process, TCP and Windows service checks', async () => {
    const probe = new LocalMonitorProbeAdapter(http, windows);
    await expect(
      probe.sample(definition('HTTP', { url: 'http://127.0.0.1/health' })),
    ).resolves.toMatchObject({ available: true, statusCode: 200 });
    await expect(probe.sample(definition('PROCESS', { name: 'node.exe' }))).resolves.toMatchObject({
      available: true,
    });
    await expect(
      probe.sample(definition('TCP', { host: '127.0.0.1', port: 5432 })),
    ).resolves.toMatchObject({ available: true });
    await expect(
      probe.sample(definition('SERVICE', { name: 'PostgreSQL' })),
    ).resolves.toMatchObject({ available: true });
  });
  it('rejects credentials, sensitive fields and unauthorized HTTP targets', async () => {
    const probe = new LocalMonitorProbeAdapter(
      { ...http, authorize: vi.fn(async () => false) },
      windows,
    );
    await expect(
      probe.sample(definition('HTTP', { url: 'https://user:pass@example.com' })),
    ).resolves.toMatchObject({ available: false, errorCode: 'http_target_not_allowed' });
    await expect(
      probe.sample(
        definition('HTTP', { url: 'https://example.com', headers: { Authorization: 'secret' } }),
      ),
    ).resolves.toMatchObject({ available: false, errorCode: 'sensitive_target_field' });
  });
});
