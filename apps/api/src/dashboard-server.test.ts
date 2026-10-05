import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiServer } from './index.js';
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }),
  );
});
async function fixture() {
  const mutate = vi.fn(async (_input: unknown, context: { correlationId: string }) => ({
    version: 'v1' as const,
    correlationId: context.correlationId,
    status: 'COMPLETED' as const,
    state: 'PAUSED',
    message: 'Mission mise en pause.',
  }));
  const application = {
    overview: vi.fn(async (correlationId: string) => ({
      version: 'v1' as const,
      generatedAt: new Date(0).toISOString(),
      correlationId,
      health: [],
      missions: [],
      approvals: [],
      incidents: [],
      schedules: [],
      usage: [],
      activity: [],
    })),
    list: vi.fn(async (_kind: never, _query: never, correlationId: string) => ({
      version: 'v1' as const,
      items: [],
      correlationId,
    })),
    diagnostic: vi.fn(async (correlationId: string) => ({
      version: 'v1' as const,
      generatedAt: new Date(0).toISOString(),
      correlationId,
      components: [],
      degraded: false,
      exportSafe: true,
    })),
    mutate,
    events: vi.fn(async () => []),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const server = createApiServer({
    application,
    pin: { verify: async (pin) => pin === '2468' },
    audit,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  const base = `http://127.0.0.1:${address.port}`;
  return { base, application, audit, mutate };
}
async function session(base: string, pin = '2468') {
  const response = await fetch(`${base}/api/v1/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' },
    body: JSON.stringify({ pin }),
  });
  const data = (await response.json()) as { csrfToken: string };
  return {
    response,
    csrf: data.csrfToken,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
  };
}
describe('local dashboard HTTP security', () => {
  it('issues a short strict HttpOnly session and required security headers', async () => {
    const value = await fixture();
    const auth = await session(value.base);
    expect(auth.response.status).toBe(201);
    expect(auth.response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(auth.response.headers.get('set-cookie')).toContain('SameSite=Strict');
    expect(auth.response.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'",
    );
    expect(auth.response.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('rotates both the cookie and CSRF proof and invalidates the previous session', async () => {
    const value = await fixture();
    const auth = await session(value.base);
    const rotated = await fetch(`${value.base}/api/v1/session/rotate`, {
      method: 'POST',
      headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf },
    });
    const payload = (await rotated.json()) as { csrfToken: string };
    const rotatedCookie = rotated.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(rotated.status).toBe(200);
    expect(rotatedCookie).not.toBe(auth.cookie);
    expect(payload.csrfToken).not.toBe(auth.csrf);
    const stale = await fetch(`${value.base}/api/v1/overview`, {
      headers: { cookie: auth.cookie },
    });
    expect(stale.status).toBe(401);
  });
  it('refuses foreign origins and direct mutation without CSRF/policy application port', async () => {
    const value = await fixture();
    const denied = await fetch(`${value.base}/api/v1/session`, {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: '{"pin":"2468"}',
    });
    expect(denied.status).toBe(403);
    const auth = await session(value.base);
    const direct = await fetch(`${value.base}/api/v1/actions`, {
      method: 'POST',
      headers: { cookie: auth.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'MISSION_PAUSE', targetId: 'm1', expectedState: 'RUNNING' }),
    });
    expect(direct.status).toBe(403);
    expect(value.mutate).not.toHaveBeenCalled();
    const allowed = await fetch(`${value.base}/api/v1/actions`, {
      method: 'POST',
      headers: {
        cookie: auth.cookie,
        'x-csrf-token': auth.csrf,
        'content-type': 'application/json',
        origin: 'http://127.0.0.1:5173',
      },
      body: JSON.stringify({ action: 'MISSION_PAUSE', targetId: 'm1', expectedState: 'RUNNING' }),
    });
    expect(allowed.status).toBe(200);
    expect(value.mutate).toHaveBeenCalledTimes(1);
  });
  it('never writes PIN, cookies or canaries to HTTP audit events', async () => {
    const value = await fixture();
    await fetch(`${value.base}/api/v1/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'canary-cookie' },
      body: JSON.stringify({ pin: 'canary-pin' }),
    });
    const serialized = JSON.stringify(value.audit.record.mock.calls);
    expect(serialized).not.toContain('canary-pin');
    expect(serialized).not.toContain('canary-cookie');
  });
});
