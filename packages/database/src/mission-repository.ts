import { assertMissionTransition, type MissionStatus } from './states.js';
import { ConcurrentUpdateError, type SqlClient } from './sql.js';

export interface MissionRecord {
  readonly publicId: string;
  readonly status: MissionStatus;
  readonly version: number;
  readonly updatedAt: Date;
}

interface MissionRow {
  public_id: string;
  status: MissionStatus;
  version: number;
  updated_at: Date;
}

function mapMission(row: MissionRow): MissionRecord {
  return {
    publicId: row.public_id,
    status: row.status,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

export class MissionRepository {
  constructor(private readonly sql: SqlClient) {}

  async findByPublicId(publicId: string): Promise<MissionRecord | null> {
    const result = await this.sql.query<MissionRow>(
      `select public_id, status, version, updated_at
       from missions
       where public_id = $1`,
      [publicId],
    );
    return result.rows[0] ? mapMission(result.rows[0]) : null;
  }

  async transition(current: MissionRecord, next: MissionStatus): Promise<MissionRecord> {
    assertMissionTransition(current.status, next);
    const result = await this.sql.query<MissionRow>(
      `update missions
       set status = $1, version = version + 1, updated_at = now()
       where public_id = $2 and status = $3 and version = $4
       returning public_id, status, version, updated_at`,
      [next, current.publicId, current.status, current.version],
    );
    const updated = result.rows[0];
    if (!updated) {
      throw new ConcurrentUpdateError('mission', current.publicId);
    }
    return mapMission(updated);
  }
}
