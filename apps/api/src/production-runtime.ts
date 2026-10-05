import { join } from 'node:path';
import { Pool } from 'pg';
import {
  FileVaultStore,
  LocalSecretVault,
  WindowsDpapiKeyProtector,
  verifyPin,
} from '@arcc/security';
import type { DashboardServerOptions } from './dashboard-server.js';
import { PostgresDashboardApplication, PostgresHttpAudit } from './postgres-dashboard.js';

export async function createProductionDashboardRuntime(environment = process.env): Promise<{
  readonly options: DashboardServerOptions;
  readonly close: () => Promise<void>;
}> {
  const dataRoot =
    environment.ARCC_DATA_ROOT ??
    (environment.LOCALAPPDATA ? join(environment.LOCALAPPDATA, 'ARCC') : undefined);
  if (!dataRoot) throw new Error('arcc_data_root_required');
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) throw new Error('database_url_required');
  const vault = await LocalSecretVault.open(
    new FileVaultStore(join(dataRoot, 'vault.json')),
    new WindowsDpapiKeyProtector(),
  );
  const pinHash = vault.get('owner-pin-hash');
  const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  await pool.query('select 1');
  return {
    options: {
      application: new PostgresDashboardApplication(pool),
      pin: { verify: async (pin) => verifyPin(pin, pinHash) },
      audit: new PostgresHttpAudit(pool),
    },
    close: async () => {
      vault.close();
      await pool.end();
    },
  };
}
