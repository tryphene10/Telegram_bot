import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runTelegramBot } from './runtime.js';

export const telegramAdapter = Object.freeze({
  service: 'telegram-bot',
  executionCapability: false,
  status: 'foundation' as const,
});

export * from './access-control.js';
export * from './commands.js';
export * from './local-state.js';
export * from './notification-worker.js';
export * from './pin-gate.js';
export * from './runtime.js';
export * from './service.js';
export * from './telegram-api.js';
export * from './callback-actions.js';
export * from './experience.js';
export * from './delivery.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const localData = process.env.LOCALAPPDATA;
  if (!localData) throw new Error('LOCALAPPDATA is required on Windows');
  const dataDirectory = join(localData, 'ARCC');
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  console.log(JSON.stringify({ event: 'service.ready', ...telegramAdapter }));
  await runTelegramBot({
    vaultPath: join(dataDirectory, 'vault.json'),
    statePath: join(dataDirectory, 'telegram-state.json'),
    preferencesPath: join(dataDirectory, 'telegram-preferences.json'),
    auditPath: join(dataDirectory, 'telegram-security.jsonl'),
    databaseUrl:
      process.env.DATABASE_URL ??
      (() => {
        throw new Error('DATABASE_URL is required');
      })(),
    signal: controller.signal,
    showLocalPairingCode: (code) => {
      console.log(`Code d'appairage local : ${code}`);
    },
  });
}
