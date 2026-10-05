alter table projects
  add column manifest_version integer not null default 1
    constraint projects_manifest_version_check check (manifest_version > 0),
  add column manifest jsonb,
  add column version integer not null default 1
    constraint projects_version_check check (version > 0);

create index projects_machine_status_idx on projects(primary_machine_id, status);

insert into schema_migrations(version) values ('0002_project_manifests');
