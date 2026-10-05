import { ConcurrentUpdateError, type SqlClient } from './sql.js';

export const KNOWLEDGE_SCOPES = ['SESSION', 'MISSION', 'PROJECT', 'USER_PREFERENCE'] as const;
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number];
export type FreshnessStatus = 'FRESH' | 'STALE' | 'EXPIRED';

export function validateKnowledgeScope(scope: string): KnowledgeScope {
  if (KNOWLEDGE_SCOPES.includes(scope as KnowledgeScope)) {
    return scope as KnowledgeScope;
  }
  throw new Error(`Unsupported knowledge scope: ${scope}`);
}

export interface KnowledgeEntryRecord {
  readonly publicId: string;
  readonly projectPublicId?: string;
  readonly missionPublicId?: string;
  readonly scope: KnowledgeScope;
  readonly key: string;
  readonly value: unknown;
  readonly classification: 'PUBLIC' | 'CLOUD_SAFE' | 'LOCAL_ONLY' | 'SECRET';
  readonly sha256: string;
  readonly version: number;
  readonly sourcePath?: string;
  readonly sourceHash?: string;
  readonly freshnessStatus: FreshnessStatus;
  readonly observedAt?: string;
  readonly expiresAt?: string;
}

interface KnowledgeEntryRow {
  public_id: string;
  project_public_id?: string | null;
  mission_public_id?: string | null;
  scope: KnowledgeScope;
  content_key: string;
  value: unknown;
  classification: 'PUBLIC' | 'CLOUD_SAFE' | 'LOCAL_ONLY' | 'SECRET';
  sha256: string;
  version: number;
  source_path?: string | null;
  source_hash?: string | null;
  freshness_status: FreshnessStatus;
  observed_at?: string | null;
  expires_at?: string | null;
}

function mapEntry(row: KnowledgeEntryRow): KnowledgeEntryRecord {
  return {
    publicId: row.public_id,
    ...(row.project_public_id ? { projectPublicId: row.project_public_id } : {}),
    ...(row.mission_public_id ? { missionPublicId: row.mission_public_id } : {}),
    scope: row.scope,
    key: row.content_key,
    value: row.value,
    classification: row.classification,
    sha256: row.sha256,
    version: row.version,
    ...(row.source_path ? { sourcePath: row.source_path } : {}),
    ...(row.source_hash ? { sourceHash: row.source_hash } : {}),
    freshnessStatus: row.freshness_status,
    ...(row.observed_at ? { observedAt: row.observed_at } : {}),
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
  };
}

export class LocalKnowledgeRepository {
  constructor(private readonly sql: SqlClient) {}

  async createEntry(input: {
    readonly userPublicId?: string;
    readonly projectPublicId?: string;
    readonly missionPublicId?: string;
    readonly sessionPublicId?: string;
    readonly sourcePublicId?: string;
    readonly scope: KnowledgeScope;
    readonly key: string;
    readonly value: unknown;
    readonly classification: 'PUBLIC' | 'CLOUD_SAFE' | 'LOCAL_ONLY' | 'SECRET';
    readonly sha256: string;
    readonly version: number;
    readonly sourcePath?: string;
    readonly sourceHash?: string;
    readonly freshnessStatus?: FreshnessStatus;
    readonly observedAt?: string;
    readonly expiresAt?: string;
  }): Promise<KnowledgeEntryRecord> {
    const scope = validateKnowledgeScope(input.scope);
    const result = await this.sql.query<KnowledgeEntryRow>(
      `insert into memory_entries (
         user_id, project_id, mission_id, session_id, source_id, scope, content_key,
         value, classification, sha256, version, source_path, source_hash,
         freshness_status, observed_at, expires_at
       )
       select u.id, p.id, m.id, session.id, source.id, $6, $7, $8::jsonb, $9,
              $10, $11, $12, $13, $14, coalesce($15::timestamptz, now()), $16
       from (select 1) seed
       left join users u on u.public_id = $1::uuid
       left join projects p on p.public_id = $2::uuid
       left join missions m on m.public_id = $3::uuid
       left join computer_use_sessions session on session.public_id = $4::uuid
       left join knowledge_sources source on source.public_id = $5::uuid
       where ($6 <> 'PROJECT' or (p.id is not null and source.project_id = p.id))
       returning public_id, scope, content_key, value, classification, sha256, version,
                 source_path, source_hash, freshness_status, observed_at::text, expires_at::text,
                 (select public_id from projects where id = memory_entries.project_id) project_public_id,
                 (select public_id from missions where id = memory_entries.mission_id) mission_public_id`,
      [
        input.userPublicId ?? null,
        input.projectPublicId ?? null,
        input.missionPublicId ?? null,
        input.sessionPublicId ?? null,
        input.sourcePublicId ?? null,
        scope,
        input.key,
        JSON.stringify(input.value),
        input.classification,
        input.sha256,
        input.version,
        input.sourcePath ?? null,
        input.sourceHash ?? null,
        input.freshnessStatus ?? 'FRESH',
        input.observedAt ?? null,
        input.expiresAt ?? null,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('knowledge_scope_not_found');
    }

    return mapEntry(row);
  }

  async markStale(publicId: string): Promise<void> {
    const result = await this.sql.query(
      `update memory_entries
       set freshness_status = $2, updated_at = now()
       where public_id = $1`,
      [publicId, 'STALE'],
    );
    if (result.rowCount !== 1) {
      throw new ConcurrentUpdateError('memory entry', publicId);
    }
  }

  async correctPreference(input: {
    readonly userPublicId: string;
    readonly key: string;
    readonly value: unknown;
    readonly sha256: string;
    readonly expectedVersion: number;
    readonly expiresAt?: string;
  }): Promise<KnowledgeEntryRecord> {
    const result = await this.sql.query<KnowledgeEntryRow>(
      `with latest as (
         select entry.version from memory_entries entry join users u on u.id = entry.user_id
         where u.public_id = $1::uuid and entry.scope = 'USER_PREFERENCE'
           and entry.content_key = $2 order by entry.version desc limit 1
       )
       insert into memory_entries(user_id,scope,content_key,value,classification,sha256,
         version,expires_at,freshness_status)
       select u.id,'USER_PREFERENCE',$2,$3::jsonb,'LOCAL_ONLY',$4,$5 + 1,$6,'FRESH'
       from users u where u.public_id = $1::uuid
         and coalesce((select version from latest),0) = $5
       returning public_id,scope,content_key,value,classification,sha256,version,
         freshness_status,observed_at::text,expires_at::text`,
      [
        input.userPublicId,
        input.key,
        JSON.stringify(input.value),
        input.sha256,
        input.expectedVersion,
        input.expiresAt ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new ConcurrentUpdateError('user preference', input.key);
    return mapEntry(row);
  }

  async extendExpiration(publicId: string, expectedExpiration: string, newExpiration: string) {
    const result = await this.sql.query(
      `update memory_entries set expires_at = $3::timestamptz, updated_at = now()
       where public_id = $1::uuid and expires_at = $2::timestamptz
         and $3::timestamptz > $2::timestamptz`,
      [publicId, expectedExpiration, newExpiration],
    );
    if (result.rowCount !== 1) throw new ConcurrentUpdateError('memory expiration', publicId);
  }
}
