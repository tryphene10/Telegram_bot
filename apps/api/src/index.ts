import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import type { DashboardApplicationPort, DashboardServerOptions } from './dashboard-server.js';
import { createDashboardHandler } from './dashboard-server.js';
import { createStaticDashboardHandler } from './static-dashboard.js';
import { createProductionDashboardRuntime } from './production-runtime.js';

export const serviceName = 'command-center-api';

export function createHealthPayload() {
  return { service: serviceName, status: 'ok' as const };
}

export function validateApiHost(host: string) {
  if (host !== '127.0.0.1' && host !== '::1') throw new Error('api_loopback_only');
  return host;
}

const unavailableApplication: DashboardApplicationPort = {
  overview: async (correlationId) => ({
    version: 'v1',
    generatedAt: new Date().toISOString(),
    correlationId,
    health: [],
    missions: [],
    approvals: [],
    incidents: [],
    schedules: [],
    usage: [],
    activity: [],
  }),
  list: async (_kind, _query, correlationId) => ({ version: 'v1', items: [], correlationId }),
  diagnostic: async (correlationId) => ({
    version: 'v1',
    generatedAt: new Date().toISOString(),
    correlationId,
    components: [],
    degraded: true,
    exportSafe: true,
  }),
  mutate: async (_input, context) => ({
    version: 'v1',
    correlationId: context.correlationId,
    status: 'DENIED',
    state: 'APPLICATION_PORT_UNAVAILABLE',
    message: 'Service applicatif indisponible.',
  }),
  events: async () => [],
};

export function createApiServer(options?: DashboardServerOptions, webRoot?: string) {
  const dashboard = createDashboardHandler(
    options ?? {
      application: unavailableApplication,
      pin: { verify: async () => false },
      audit: { record: async () => undefined },
    },
  );
  const staticDashboard = webRoot ? createStaticDashboardHandler(webRoot) : undefined;
  return createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (!staticDashboard || path === '/health' || path === '/ready' || path.startsWith('/api/')) {
      void dashboard(request, response);
      return;
    }
    void staticDashboard(request, response);
  });
}

export * from './dashboard-server.js';
export * from './postgres-dashboard.js';
export * from './production-runtime.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.API_HOST ?? '127.0.0.1';
  validateApiHost(host);
  const port = Number.parseInt(process.env.API_PORT ?? '4000', 10);
  const runtime = process.env.DATABASE_URL ? await createProductionDashboardRuntime() : undefined;
  const server = createApiServer(runtime?.options, process.env.ARCC_WEB_ROOT);
  const close = async () => {
    server.close();
    await runtime?.close();
  };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
  server.listen(port, host, () => {
    console.log(JSON.stringify({ event: 'service.ready', host, port, service: serviceName }));
  });
}
