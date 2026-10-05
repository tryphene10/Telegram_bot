import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardApiClient } from './api-client.js';
import type { DashboardApiError } from './api-client.js';
afterEach(() => vi.unstubAllGlobals());
describe('DashboardApiClient', () => {
  it('keeps CSRF only in memory and sends it on mutation', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ csrfToken: 'csrf-once' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            version: 'v1',
            correlationId: 'c1',
            status: 'COMPLETED',
            state: 'PAUSED',
            message: 'ok',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const client = new DashboardApiClient();
    await client.authenticate('2468');
    await client.action({ action: 'MISSION_PAUSE', targetId: 'm1', expectedState: 'RUNNING' });
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({ 'x-csrf-token': 'csrf-once' });
    expect(JSON.stringify(globalThis.localStorage ?? {})).not.toContain('csrf-once');
  });
  it('returns structured API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              version: 'v1',
              error: {
                code: 'session_required',
                message: 'x',
                correlationId: 'c2',
                retryable: false,
              },
            }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    await expect(new DashboardApiClient().overview()).rejects.toEqual(
      expect.objectContaining<Partial<DashboardApiError>>({
        code: 'session_required',
        correlationId: 'c2',
      }),
    );
  });
});
