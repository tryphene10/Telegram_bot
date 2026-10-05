import { ConcurrentUpdateError, type SqlClient } from './sql.js';

export interface PersistedAdaptivePlan {
  readonly missionPublicId: string;
  readonly missionVersion: number;
  readonly plan: Readonly<Record<string, unknown>>;
}

interface AdaptivePlanRow {
  public_id: string;
  version: number;
  plan: Record<string, unknown>;
}

function mapPlan(row: AdaptivePlanRow): PersistedAdaptivePlan {
  return {
    missionPublicId: row.public_id,
    missionVersion: row.version,
    plan: row.plan,
  };
}

export class AdaptivePlanRepository {
  constructor(private readonly sql: SqlClient) {}

  async save(
    missionPublicId: string,
    expectedMissionVersion: number,
    plan: Readonly<Record<string, unknown>>,
  ): Promise<PersistedAdaptivePlan> {
    const result = await this.sql.query<AdaptivePlanRow>(
      `update missions
       set plan = $3::jsonb, version = version + 1, updated_at = now()
       where public_id = $1::uuid and version = $2
         and status in ('CREATED', 'QUEUED', 'PLANNING', 'WAITING_FOR_USER', 'PAUSED')
       returning public_id, version, plan`,
      [missionPublicId, expectedMissionVersion, JSON.stringify(plan)],
    );
    const row = result.rows[0];
    if (!row) throw new ConcurrentUpdateError('adaptive mission plan', missionPublicId);
    return mapPlan(row);
  }

  async load(missionPublicId: string): Promise<PersistedAdaptivePlan | undefined> {
    const result = await this.sql.query<AdaptivePlanRow>(
      `select public_id, version, plan from missions
       where public_id = $1::uuid and plan is not null`,
      [missionPublicId],
    );
    const row = result.rows[0];
    return row ? mapPlan(row) : undefined;
  }
}
