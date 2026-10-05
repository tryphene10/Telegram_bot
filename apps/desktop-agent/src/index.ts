import { pathToFileURL } from 'node:url';

export const desktopAgent = Object.freeze({
  service: 'desktop-agent',
  toolsEnabled: false,
  computerUseAvailable: process.platform === 'win32',
  uiInputEnabledByDefault: false,
  status: 'guarded' as const,
});

export * from './capabilities.js';
export * from './execution-gate.js';
export * from './identity-store.js';
export * from './transport.js';
export * from './windows-screenshot.js';
export * from './browser-service.js';
export * from './playwright-browser-driver.js';
export * from './browser-toolset.js';
export * from './registry-tool-runner.js';
export * from './terminal-runner.js';
export * from './terminal-toolset.js';
export * from './git-service.js';
export * from './exact-command-executor.js';
export * from './docker-service.js';
export * from './development-toolset.js';
export * from './computer-use-core.js';
export * from './file-emergency-stop.js';
export * from './adaptive-computer-use.js';
export * from './windows-window-observer.js';
export * from './windows-uia.js';
export * from './windows-window-controller.js';
export * from './windows-input-driver.js';
export * from './windows-desktop-driver.js';
export * from './computer-use-toolset.js';
export * from './managed-application-catalog.js';
export * from './windows-user-activity.js';
export * from './computer-use-proof.js';
export * from './adaptive-mission-adapter.js';
export * from './postgres-mission-worker.js';
export * from './postgres-operations-runtime.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  const { createProductionMissionWorker } = await import('./postgres-mission-worker.js');
  const { createPostgresOperationsRuntime } = await import('./postgres-operations-runtime.js');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const missionRuntime = await createProductionMissionWorker();
  const operationsRuntime = await createPostgresOperationsRuntime(databaseUrl);
  console.log(
    JSON.stringify({
      event: 'service.ready',
      ...desktopAgent,
      missionWorker: true,
      schedulerWorker: true,
      monitorWorker: true,
    }),
  );
  try {
    await Promise.all([
      missionRuntime.worker.run(controller.signal),
      operationsRuntime.runtime.run(controller.signal),
    ]);
  } finally {
    await Promise.all([missionRuntime.close(), operationsRuntime.close()]);
  }
}
