import { ConcurrentUpdateError, type SqlClient } from './sql.js';

export interface ProjectRecord {
  readonly publicId: string;
  readonly name: string;
  readonly rootPath: string;
  readonly status: 'ACTIVE' | 'ARCHIVED';
  readonly manifestVersion: number;
  readonly manifest: unknown;
  readonly version: number;
}

interface ProjectRow {
  public_id: string;
  name: string;
  root_path: string;
  status: 'ACTIVE' | 'ARCHIVED';
  manifest_version: number;
  manifest: unknown;
  version: number;
}

function map(row: ProjectRow): ProjectRecord {
  return {
    publicId: row.public_id,
    name: row.name,
    rootPath: row.root_path,
    status: row.status,
    manifestVersion: row.manifest_version,
    manifest: row.manifest,
    version: row.version,
  };
}

export class ProjectRepository {
  constructor(private readonly sql: SqlClient) {}

  async create(input: {
    readonly ownerPublicId: string;
    readonly machinePublicId: string;
    readonly name: string;
    readonly rootPath: string;
    readonly manifest: unknown;
  }): Promise<ProjectRecord> {
    const result = await this.sql.query<ProjectRow>(
      `insert into projects(owner_id, primary_machine_id, name, root_path, manifest)
       select users.id, machines.id, $3, $4, $5::jsonb
       from users cross join machines
       where users.public_id = $1 and machines.public_id = $2
       returning public_id, name, root_path, status, manifest_version, manifest, version`,
      [input.ownerPublicId, input.machinePublicId, input.name, input.rootPath, input.manifest],
    );
    const created = result.rows[0];
    if (!created) throw new Error('Project owner or machine was not found');
    return map(created);
  }

  async find(publicId: string): Promise<ProjectRecord | null> {
    const result = await this.sql.query<ProjectRow>(
      `select public_id, name, root_path, status, manifest_version, manifest, version
       from projects where public_id = $1`,
      [publicId],
    );
    return result.rows[0] ? map(result.rows[0]) : null;
  }

  async updateManifest(
    publicId: string,
    expectedVersion: number,
    manifestVersion: number,
    manifest: unknown,
  ): Promise<ProjectRecord> {
    const result = await this.sql.query<ProjectRow>(
      `update projects
       set manifest_version = $1, manifest = $2::jsonb, version = version + 1, updated_at = now()
       where public_id = $3 and version = $4 and status = 'ACTIVE'
       returning public_id, name, root_path, status, manifest_version, manifest, version`,
      [manifestVersion, manifest, publicId, expectedVersion],
    );
    const updated = result.rows[0];
    if (!updated) throw new ConcurrentUpdateError('project', publicId);
    return map(updated);
  }

  async archive(publicId: string, expectedVersion: number): Promise<void> {
    const result = await this.sql.query(
      `update projects set status = 'ARCHIVED', version = version + 1, updated_at = now()
       where public_id = $1 and version = $2 and status = 'ACTIVE'`,
      [publicId, expectedVersion],
    );
    if (result.rowCount !== 1) throw new ConcurrentUpdateError('project', publicId);
  }

  async deleteArchived(publicId: string, expectedVersion: number): Promise<void> {
    const result = await this.sql.query(
      `delete from projects where public_id = $1 and version = $2 and status = 'ARCHIVED'`,
      [publicId, expectedVersion],
    );
    if (result.rowCount !== 1) throw new ConcurrentUpdateError('project', publicId);
  }
}
