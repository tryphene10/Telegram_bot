create table knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  project_id bigint not null references projects(id) on delete cascade,
  mission_id bigint references missions(id) on delete cascade,
  source_type text not null check (source_type in ('README','MARKDOWN','TEXT','REPORT','DECISION')),
  relative_path text not null check (length(relative_path) between 1 and 1024),
  title text not null check (length(title) between 1 and 500),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  version integer not null check (version > 0),
  size_bytes bigint not null check (size_bytes between 0 and 10485760),
  modified_at timestamptz not null,
  observed_at timestamptz not null default now(),
  expires_at timestamptz,
  freshness_status text not null default 'FRESH'
    check (freshness_status in ('FRESH','STALE','EXPIRED','DELETED')),
  invalidation_reason text,
  git_head text check (git_head is null or git_head ~ '^[a-f0-9]{40,64}$'),
  git_dirty boolean,
  classification text not null default 'LOCAL_ONLY' check (classification = 'LOCAL_ONLY'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_sources_invalidation_reason_check check (
    freshness_status = 'FRESH' or invalidation_reason is not null
  ),
  unique(project_id, relative_path, sha256, version)
);

create index knowledge_sources_project_path_idx
  on knowledge_sources(project_id, relative_path, version desc);
create index knowledge_sources_freshness_idx
  on knowledge_sources(freshness_status, updated_at)
  where freshness_status <> 'FRESH';
create index knowledge_sources_expiry_idx
  on knowledge_sources(expires_at) where expires_at is not null;

create table memory_entries (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  user_id bigint references users(id) on delete cascade,
  project_id bigint references projects(id) on delete cascade,
  mission_id bigint references missions(id) on delete cascade,
  session_id uuid references computer_use_sessions(id) on delete cascade,
  source_id uuid references knowledge_sources(id) on delete cascade,
  scope text not null check (scope in ('SESSION','MISSION','PROJECT','USER_PREFERENCE')),
  content_key text not null check (length(content_key) between 1 and 200),
  value jsonb not null,
  classification text not null check (classification in ('PUBLIC','CLOUD_SAFE','LOCAL_ONLY','SECRET')),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  version integer not null check (version > 0),
  source_path text,
  source_hash text check (source_hash is null or source_hash ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null default now(),
  expires_at timestamptz,
  freshness_status text not null default 'FRESH'
    check (freshness_status in ('FRESH','STALE','EXPIRED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memory_entries_scope_owner_check check (
    (scope = 'SESSION' and session_id is not null) or
    (scope = 'MISSION' and mission_id is not null) or
    (scope = 'PROJECT' and project_id is not null and source_id is not null and
      source_path is not null and source_hash is not null) or
    (scope = 'USER_PREFERENCE' and user_id is not null)
  ),
  constraint memory_entries_project_local_only_check
    check (project_id is null or classification = 'LOCAL_ONLY'),
  unique(scope, content_key, version, project_id, mission_id, session_id, user_id)
);

create index memory_entries_project_fresh_idx
  on memory_entries(project_id, freshness_status, observed_at desc);
create index memory_entries_mission_idx on memory_entries(mission_id, observed_at desc);
create index memory_entries_session_idx on memory_entries(session_id, observed_at desc);
create index memory_entries_expiry_idx on memory_entries(expires_at)
  where expires_at is not null;
create unique index memory_entries_project_version_unique
  on memory_entries(project_id,content_key,version) where scope = 'PROJECT';
create unique index memory_entries_mission_version_unique
  on memory_entries(mission_id,content_key,version) where scope = 'MISSION';
create unique index memory_entries_session_version_unique
  on memory_entries(session_id,content_key,version) where scope = 'SESSION';
create unique index memory_entries_preference_version_unique
  on memory_entries(user_id,content_key,version) where scope = 'USER_PREFERENCE';

create table knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  source_id uuid not null references knowledge_sources(id) on delete cascade,
  ordinal integer not null check (ordinal >= 0),
  section text not null check (length(section) between 1 and 500),
  anchor text not null check (anchor ~ '^[a-z0-9][a-z0-9-]{0,199}$'),
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null check (end_offset > start_offset),
  content_sanitized text not null check (length(content_sanitized) between 1 and 20000),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  classification text not null default 'LOCAL_ONLY' check (classification = 'LOCAL_ONLY'),
  search_config regconfig not null default 'simple',
  search_vector tsvector not null,
  created_at timestamptz not null default now(),
  unique(source_id, ordinal),
  unique(source_id, sha256)
);

create index knowledge_chunks_source_idx on knowledge_chunks(source_id, ordinal);
create index knowledge_chunks_search_idx on knowledge_chunks using gin(search_vector);

create table knowledge_embeddings (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  chunk_id uuid not null references knowledge_chunks(id) on delete cascade,
  model text not null check (length(model) between 1 and 200),
  dimension integer not null check (dimension between 1 and 8192),
  namespace text not null check (namespace ~ '^[a-zA-Z0-9._:-]{1,255}$'),
  vector double precision[] not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  constraint knowledge_embeddings_vector_dimension_check check (cardinality(vector) = dimension),
  unique(chunk_id, model, dimension),
  unique(namespace, chunk_id)
);

create index knowledge_embeddings_namespace_idx
  on knowledge_embeddings(namespace, chunk_id);

create table knowledge_index_jobs (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  project_id bigint not null references projects(id) on delete cascade,
  source_id uuid references knowledge_sources(id) on delete set null,
  job_key text not null check (length(job_key) between 8 and 200),
  status text not null default 'QUEUED'
    check (status in ('QUEUED','RUNNING','RETRYING','COMPLETED','FAILED','CANCELLED')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  lease_owner text,
  lease_until timestamptz,
  error_code text,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(project_id, job_key)
);

create index knowledge_index_jobs_fifo_idx
  on knowledge_index_jobs(created_at, id) where status in ('QUEUED','RETRYING');
create index knowledge_index_jobs_recovery_idx
  on knowledge_index_jobs(lease_until) where status = 'RUNNING';

create table memory_tombstones (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  project_public_id uuid not null,
  reason text not null check (length(reason) between 1 and 500),
  deleted_counts jsonb not null,
  purge_digest text not null check (purge_digest ~ '^[a-f0-9]{64}$'),
  purged_at timestamptz not null default now(),
  unique(project_public_id, purge_digest)
);

create index memory_tombstones_project_idx
  on memory_tombstones(project_public_id, purged_at desc);

insert into schema_migrations(version) values ('0008_local_knowledge');
