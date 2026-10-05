import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiServer, createHealthPayload } from './index.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }),
  );
});

describe('command-center API foundation', () => {
  it('returns a stable health payload', () => {
    expect(createHealthPayload()).toEqual({ service: 'command-center-api', status: 'ok' });
  });

  it('serves health without exposing an execution endpoint', async () => {
    const server = createApiServer();
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');

    const health = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ service: 'command-center-api', status: 'ok' });

    const unknown = await fetch(`http://127.0.0.1:${address.port}/execute`);
    expect(unknown.status).toBe(404);
  });
});
