delete from schema_migrations where version = '0008_local_knowledge';
drop table if exists memory_tombstones;
drop table if exists knowledge_index_jobs;
drop table if exists knowledge_embeddings;
drop table if exists knowledge_chunks;
drop table if exists memory_entries;
drop table if exists knowledge_sources;
