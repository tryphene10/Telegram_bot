import { createHash } from 'node:crypto';
import { ConcurrentUpdateError, type SqlClient } from './sql.js';

interface SourceRow {
  source_id: string;
  inserted: boolean;
  chunk_count: string | number;
}
interface SearchRow {
  chunk_id: string;
  source_id: string;
  project_id: string;
  relative_path: string;
  section: string;
  anchor: string;
  source_hash: string;
  chunk_hash: string;
  version: number;
  observed_at: string;
  freshness: 'FRESH' | 'STALE' | 'EXPIRED' | 'DELETED';
  excerpt: string;
  lexical_score: string | number;
}

function result(row: SearchRow) {
  return {
    chunkId: row.chunk_id,
    sourceId: row.source_id,
    projectId: row.project_id,
    relativePath: row.relative_path,
    section: row.section,
    anchor: row.anchor,
    sourceHash: row.source_hash,
    chunkHash: row.chunk_hash,
    version: row.version,
    observedAt: row.observed_at,
    freshness: row.freshness,
    excerpt: row.excerpt,
    lexicalScore: Number(row.lexical_score),
  };
}

export class KnowledgeStoreRepository {
  constructor(private readonly sql: SqlClient) {}

  async upsert(input: {
    readonly source: Readonly<{
      projectId: string;
      missionId?: string;
      sourceType: string;
      relativePath: string;
      title: string;
      sha256: string;
      version: number;
      sizeBytes: number;
      modifiedAt: string;
      observedAt: string;
      gitHead?: string;
      gitDirty?: boolean;
    }>;
    readonly chunks: readonly Readonly<{
      ordinal: number;
      section: string;
      anchor: string;
      startOffset: number;
      endOffset: number;
      content: string;
      sha256: string;
    }>[];
    readonly searchConfig: string;
  }): Promise<Readonly<{ sourceId: string; inserted: boolean; chunks: number }>> {
    const source = input.source;
    const rows = input.chunks.map((chunk) => ({
      ordinal: chunk.ordinal,
      section: chunk.section,
      anchor: chunk.anchor,
      start_offset: chunk.startOffset,
      end_offset: chunk.endOffset,
      content: chunk.content,
      sha256: chunk.sha256,
    }));
    const query = await this.sql.query<SourceRow>(
      `with scope as (
         select p.id project_id, m.id mission_id from projects p
         left join missions m on m.public_id = $2::uuid
         where p.public_id = $1::uuid and ($2::uuid is null or m.project_id = p.id)
       ), inserted as (
         insert into knowledge_sources(project_id,mission_id,source_type,relative_path,title,
           sha256,version,size_bytes,modified_at,observed_at,git_head,git_dirty)
         select project_id,mission_id,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 from scope
         on conflict (project_id,relative_path,sha256,version) do nothing
         returning id,public_id,true inserted
       ), chosen as (
         select id,public_id,inserted from inserted union all
         select s.id,s.public_id,false from knowledge_sources s join scope on scope.project_id=s.project_id
         where s.relative_path=$4 and s.sha256=$6 and s.version=$7
           and not exists(select 1 from inserted) limit 1
       ), chunks as (
         insert into knowledge_chunks(source_id,ordinal,section,anchor,start_offset,end_offset,
           content_sanitized,sha256,search_config,search_vector)
         select chosen.id,v.ordinal,v.section,v.anchor,v.start_offset,v.end_offset,v.content,
           v.sha256,$14::regconfig,to_tsvector($14::regconfig,v.section||' '||v.content)
         from chosen cross join jsonb_to_recordset($13::jsonb) as v(
           ordinal integer,section text,anchor text,start_offset integer,end_offset integer,
           content text,sha256 text) where chosen.inserted
         on conflict (source_id,ordinal) do nothing returning id
       ) select chosen.public_id source_id,chosen.inserted,case when chosen.inserted
           then (select count(*) from chunks)
           else (select count(*) from knowledge_chunks where source_id=chosen.id)
         end chunk_count from chosen`,
      [
        source.projectId,
        source.missionId ?? null,
        source.sourceType,
        source.relativePath,
        source.title,
        source.sha256,
        source.version,
        source.sizeBytes,
        source.modifiedAt,
        source.observedAt,
        source.gitHead ?? null,
        source.gitDirty ?? null,
        JSON.stringify(rows),
        input.searchConfig,
      ],
    );
    const row = query.rows[0];
    if (!row) throw new Error('knowledge_project_or_mission_not_found');
    return { sourceId: row.source_id, inserted: row.inserted, chunks: Number(row.chunk_count) };
  }

  async lexical(input: {
    readonly projectId: string;
    readonly missionId?: string;
    readonly query: string;
    readonly sourceTypes?: readonly string[];
    readonly freshness?: readonly string[];
    readonly observedAfter?: string;
    readonly searchConfig: string;
    readonly limit: number;
    readonly excerptCharacters: number;
    readonly timeoutMs: number;
  }) {
    const query = await this.sql.query<SearchRow>(
      `with timeout as (select set_config('statement_timeout',$10,true)), q as (
         select websearch_to_tsquery($7::regconfig,$3) value from timeout)
       select c.public_id chunk_id,s.public_id source_id,p.public_id project_id,s.relative_path,
         c.section,c.anchor,s.sha256 source_hash,c.sha256 chunk_hash,s.version,
         s.observed_at::text,s.freshness_status freshness,
         left(ts_headline($7::regconfig,c.content_sanitized,q.value,
           'MaxFragments=2, MaxWords=35, MinWords=8'),$9) excerpt,
         ts_rank_cd(c.search_vector,q.value,32) lexical_score
       from knowledge_chunks c join knowledge_sources s on s.id=c.source_id
       join projects p on p.id=s.project_id cross join q
       left join missions m on m.id=s.mission_id
       where p.public_id=$1::uuid
         and ($2::uuid is null or s.mission_id is null or m.public_id=$2::uuid)
         and s.freshness_status=any($4::text[])
         and ($5::text[] is null or s.source_type=any($5::text[]))
         and ($6::timestamptz is null or s.observed_at >= $6) and c.search_vector@@q.value
       order by lexical_score desc,s.relative_path,c.ordinal limit $8`,
      [
        input.projectId,
        input.missionId ?? null,
        input.query,
        input.freshness ?? ['FRESH'],
        input.sourceTypes ?? null,
        input.observedAfter ?? null,
        input.searchConfig,
        input.limit,
        input.excerptCharacters,
        `${input.timeoutMs}ms`,
      ],
    );
    return query.rows.map(result);
  }

  async citation(sourceId: string, chunkHash: string) {
    const query = await this.sql.query<SearchRow>(
      `select c.public_id chunk_id,s.public_id source_id,p.public_id project_id,s.relative_path,
        c.section,c.anchor,s.sha256 source_hash,c.sha256 chunk_hash,s.version,s.observed_at::text,
        s.freshness_status freshness,c.content_sanitized excerpt,1::float lexical_score
       from knowledge_chunks c join knowledge_sources s on s.id=c.source_id
       join projects p on p.id=s.project_id where s.public_id=$1::uuid and c.sha256=$2`,
      [sourceId, chunkHash],
    );
    return query.rows[0] ? result(query.rows[0]) : undefined;
  }

  async saveEmbeddings(items: readonly Readonly<Record<string, unknown>>[]): Promise<number> {
    if (!items.length) return 0;
    const query = await this.sql.query(
      `insert into knowledge_embeddings(chunk_id,model,dimension,namespace,vector,sha256)
       select c.id,v.model,v.dimension,v.namespace,v.vector,v.sha256
       from jsonb_to_recordset($1::jsonb) as v(chunk_id uuid,model text,dimension integer,
         namespace text,vector double precision[],sha256 text)
       join knowledge_chunks c on c.public_id=v.chunk_id
       on conflict (chunk_id,model,dimension) do update set namespace=excluded.namespace,
         vector=excluded.vector,sha256=excluded.sha256`,
      [
        JSON.stringify(
          items.map((item) => ({
            chunk_id: item.chunkId,
            model: item.model,
            dimension: item.dimension,
            namespace: item.namespace,
            vector: item.vector,
            sha256: item.sha256,
          })),
        ),
      ],
    );
    return query.rowCount;
  }

  async load(input: { projectId: string; model: string; dimension: number; limit: number }) {
    const query = await this.sql.query<{ chunk_id: string; vector: number[] }>(
      `select c.public_id chunk_id,e.vector from knowledge_embeddings e
       join knowledge_chunks c on c.id=e.chunk_id join knowledge_sources s on s.id=c.source_id
       join projects p on p.id=s.project_id
       where p.public_id=$1::uuid and e.model=$2 and e.dimension=$3
         and e.namespace=$2||':'||$3::text and s.freshness_status='FRESH'
       order by c.public_id limit $4`,
      [input.projectId, input.model, input.dimension, Math.min(500, input.limit)],
    );
    return query.rows.map((row) => ({ chunkId: row.chunk_id, vector: row.vector }));
  }

  async markStale(sourceId: string, reason = 'source_changed') {
    return this.mark(sourceId, 'STALE', reason);
  }
  async markDeleted(sourceId: string, reason = 'source_missing') {
    return this.mark(sourceId, 'DELETED', reason);
  }
  private async mark(sourceId: string, status: 'STALE' | 'DELETED', _reason: string) {
    const query = await this.sql.query(
      `update knowledge_sources set freshness_status=$2,invalidation_reason=$3,updated_at=now()
       where public_id=$1::uuid`,
      [sourceId, status, _reason],
    );
    if (query.rowCount !== 1) throw new ConcurrentUpdateError('knowledge source', sourceId);
  }

  async enqueueReindex(projectId: string, sourceId: string, reason: string) {
    const query = await this.sql.query<{ public_id: string }>(
      `insert into knowledge_index_jobs(project_id,source_id,job_key,metrics)
       select p.id,s.id,'reindex:'||s.public_id,jsonb_build_object('reason',$3)
       from projects p join knowledge_sources s on s.project_id=p.id
       where p.public_id=$1::uuid and s.public_id=$2::uuid
       on conflict(project_id,job_key) do update set status=case
         when knowledge_index_jobs.status='COMPLETED' then 'QUEUED'
         else knowledge_index_jobs.status end,updated_at=now() returning public_id`,
      [projectId, sourceId, reason],
    );
    if (!query.rows[0]) throw new Error('knowledge_source_not_found');
    return query.rows[0].public_id;
  }

  async enqueueProjectReindex(projectId: string, reason: string) {
    const query = await this.sql.query<{ public_id: string }>(
      `insert into knowledge_index_jobs(project_id,job_key,metrics)
       select p.id,'project:'||p.public_id,jsonb_build_object('reason',$2)
       from projects p where p.public_id=$1::uuid
       on conflict(project_id,job_key) do update set status=case
         when knowledge_index_jobs.status='COMPLETED' then 'QUEUED'
         else knowledge_index_jobs.status end,updated_at=now() returning public_id`,
      [projectId, reason],
    );
    if (!query.rows[0]) throw new Error('knowledge_project_not_found');
    return query.rows[0].public_id;
  }

  async recoverExpired(): Promise<number> {
    const query = await this.sql.query(
      `with cancelled as (
         update knowledge_index_jobs set status='CANCELLED',lease_owner=null,lease_until=null,
           error_code='SOURCE_ORPHANED',updated_at=now()
         where source_id is null and job_key like 'reindex:%'
           and status in ('QUEUED','RUNNING','RETRYING') returning id
       ) update knowledge_index_jobs set status=case when attempts>=5 then 'FAILED' else 'RETRYING' end,
       lease_owner=null,lease_until=null,error_code='LEASE_EXPIRED',updated_at=now()
       where status='RUNNING' and lease_until<now()`,
    );
    return query.rowCount;
  }

  async claim(worker: string, leaseSeconds: number) {
    const query = await this.sql.query<{
      public_id: string;
      project_id: string;
      source_id: string | null;
      job_key: string;
      attempts: number;
    }>(
      `with candidate as (select id from knowledge_index_jobs where status in ('QUEUED','RETRYING')
       order by created_at,id for update skip locked limit 1)
       update knowledge_index_jobs j set status='RUNNING',attempts=attempts+1,lease_owner=$1,
       lease_until=now()+make_interval(secs=>$2),updated_at=now() from candidate
       where j.id=candidate.id returning j.public_id,
       (select public_id from projects where id=j.project_id) project_id,
       (select public_id from knowledge_sources where id=j.source_id) source_id,j.job_key,j.attempts`,
      [worker, leaseSeconds],
    );
    const row = query.rows[0];
    return row
      ? {
          id: row.public_id,
          projectId: row.project_id,
          ...(row.source_id ? { sourceId: row.source_id } : {}),
          jobKey: row.job_key,
          attempts: row.attempts,
        }
      : undefined;
  }

  async complete(jobId: string, worker: string, metrics: Readonly<Record<string, number>>) {
    const query = await this.sql.query(
      `update knowledge_index_jobs set status='COMPLETED',metrics=$3::jsonb,lease_owner=null,
       lease_until=null,completed_at=now(),updated_at=now()
       where public_id=$1::uuid and lease_owner=$2 and status='RUNNING'`,
      [jobId, worker, JSON.stringify(metrics)],
    );
    if (query.rowCount !== 1) throw new ConcurrentUpdateError('knowledge index job', jobId);
  }

  async fail(jobId: string, worker: string, errorCode: string, retryable: boolean) {
    const query = await this.sql.query(
      `update knowledge_index_jobs set status=case when $4 then 'RETRYING' else 'FAILED' end,
       error_code=$3,lease_owner=null,lease_until=null,updated_at=now()
       where public_id=$1::uuid and lease_owner=$2 and status='RUNNING'`,
      [jobId, worker, errorCode, retryable],
    );
    if (query.rowCount !== 1) throw new ConcurrentUpdateError('knowledge index job', jobId);
  }

  async purgeProject(projectId: string, reason: string) {
    const digest = createHash('sha256').update(`${projectId}:${reason}`).digest('hex');
    const query = await this.sql.query<{
      sources: string | number;
      chunks: string | number;
      embeddings: string | number;
      entries: string | number;
      jobs: string | number;
      tombstone_id: string;
    }>(
      `with p as(select id,public_id from projects where public_id=$1::uuid),counts as(select
       (select count(*) from knowledge_sources s where s.project_id=p.id) sources,
       (select count(*) from knowledge_chunks c join knowledge_sources s on s.id=c.source_id where s.project_id=p.id) chunks,
       (select count(*) from knowledge_embeddings e join knowledge_chunks c on c.id=e.chunk_id join knowledge_sources s on s.id=c.source_id where s.project_id=p.id) embeddings,
       (select count(*) from memory_entries m where m.project_id=p.id) entries,
       (select count(*) from knowledge_index_jobs j where j.project_id=p.id) jobs from p),
       de as(delete from memory_entries where project_id=(select id from p)),
       ds as(delete from knowledge_sources where project_id=(select id from p)),
       dj as(delete from knowledge_index_jobs where project_id=(select id from p)),t as(
       insert into memory_tombstones(project_public_id,reason,deleted_counts,purge_digest)
       select p.public_id,$2,jsonb_build_object('sources',sources,'chunks',chunks,
       'embeddings',embeddings,'entries',entries,'jobs',jobs),$3 from p cross join counts
       on conflict(project_public_id,purge_digest) do update set reason=excluded.reason returning public_id)
       select counts.*,t.public_id tombstone_id from counts cross join t`,
      [projectId, reason, digest],
    );
    const row = query.rows[0];
    if (!row) throw new Error('knowledge_project_not_found');
    return {
      sources: Number(row.sources),
      chunks: Number(row.chunks),
      embeddings: Number(row.embeddings),
      entries: Number(row.entries),
      jobs: Number(row.jobs),
      derivedFiles: 0,
      tombstoneId: row.tombstone_id,
      purgeDigest: digest,
    };
  }

  async runRetention() {
    const query = await this.sql.query<{ sources: string | number; entries: string | number }>(
      `with s as(update knowledge_sources set freshness_status='EXPIRED',updated_at=now()
       ,invalidation_reason='retention_expired'
       where expires_at<=now() and freshness_status not in('EXPIRED','DELETED') returning id),
       e as(update memory_entries set freshness_status='EXPIRED',updated_at=now()
       where expires_at<=now() and freshness_status<>'EXPIRED' returning id)
       select (select count(*) from s) sources,(select count(*) from e) entries`,
    );
    return {
      sources: Number(query.rows[0]?.sources ?? 0),
      entries: Number(query.rows[0]?.entries ?? 0),
    };
  }
}
