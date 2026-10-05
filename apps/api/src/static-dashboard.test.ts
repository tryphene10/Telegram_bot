import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiServer } from './index.js';

const servers: Server[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('production dashboard server', () => {
  it('serves the SPA with strict headers and keeps API health available', async () => {
    const root = join(tmpdir(), `arcc-static-${process.pid}-${Date.now()}`);
    roots.push(root);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'index.html'), '<!doctype html><title>ARCC</title>');
    const server = createApiServer(undefined, root);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('address');
    const base = `http://127.0.0.1:${address.port}`;
    const page = await fetch(`${base}/missions`);
    expect(await page.text()).toContain('<title>ARCC</title>');
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });
});
