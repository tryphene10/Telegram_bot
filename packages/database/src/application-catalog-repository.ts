import { ConcurrentUpdateError, type SqlClient } from './sql.js';

export interface ApplicationCatalogEntry {
  readonly publicId: string;
  readonly appKey: string;
  readonly displayName: string;
  readonly executablePath: string;
  readonly executableSha256?: string;
  readonly launchProfile: Readonly<Record<string, unknown>>;
  readonly versionHint?: string;
  readonly enabled: boolean;
}

interface ApplicationRow {
  public_id: string;
  app_key: string;
  display_name: string;
  executable_path: string;
  executable_sha256: string | null;
  launch_profile: Record<string, unknown>;
  version_hint: string | null;
  enabled: boolean;
}

function mapApplication(row: ApplicationRow): ApplicationCatalogEntry {
  return {
    publicId: row.public_id,
    appKey: row.app_key,
    displayName: row.display_name,
    executablePath: row.executable_path,
    ...(row.executable_sha256 ? { executableSha256: row.executable_sha256 } : {}),
    launchProfile: row.launch_profile,
    ...(row.version_hint ? { versionHint: row.version_hint } : {}),
    enabled: row.enabled,
  };
}

const returning = `returning public_id, app_key, display_name, executable_path,
  executable_sha256, launch_profile, version_hint, enabled`;

export class ApplicationCatalogRepository {
  constructor(private readonly sql: SqlClient) {}

  async register(input: {
    readonly machinePublicId: string;
    readonly appKey: string;
    readonly displayName: string;
    readonly executablePath: string;
    readonly executableSha256?: string;
    readonly launchProfile?: Readonly<Record<string, unknown>>;
    readonly versionHint?: string;
  }): Promise<ApplicationCatalogEntry> {
    const result = await this.sql.query<ApplicationRow>(
      `insert into application_catalog (
         machine_id, app_key, display_name, executable_path, executable_sha256,
         launch_profile, version_hint, enabled
       )
       select id, $2, $3, $4, $5, $6::jsonb, $7, false
       from machines where public_id = $1::uuid
       on conflict (machine_id, app_key) do update set
         display_name = excluded.display_name,
         executable_path = excluded.executable_path,
         executable_sha256 = excluded.executable_sha256,
         launch_profile = excluded.launch_profile,
         version_hint = excluded.version_hint,
         enabled = false,
         updated_at = now()
       ${returning}`,
      [
        input.machinePublicId,
        input.appKey,
        input.displayName,
        input.executablePath,
        input.executableSha256 ?? null,
        JSON.stringify(input.launchProfile ?? {}),
        input.versionHint ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('catalog_machine_not_found');
    return mapApplication(row);
  }

  async setEnabled(publicId: string, enabled: boolean): Promise<ApplicationCatalogEntry> {
    const result = await this.sql.query<ApplicationRow>(
      `update application_catalog set enabled = $2, updated_at = now()
       where public_id = $1::uuid
       ${returning}`,
      [publicId, enabled],
    );
    const row = result.rows[0];
    if (!row) throw new ConcurrentUpdateError('application catalog entry', publicId);
    return mapApplication(row);
  }

  async findEnabled(
    machinePublicId: string,
    appKey: string,
  ): Promise<ApplicationCatalogEntry | undefined> {
    const result = await this.sql.query<ApplicationRow>(
      `select app.public_id, app.app_key, app.display_name, app.executable_path,
              app.executable_sha256, app.launch_profile, app.version_hint, app.enabled
       from application_catalog app
       join machines machine on machine.id = app.machine_id
       where machine.public_id = $1::uuid and app.app_key = $2 and app.enabled = true`,
      [machinePublicId, appKey],
    );
    const row = result.rows[0];
    return row ? mapApplication(row) : undefined;
  }
}
