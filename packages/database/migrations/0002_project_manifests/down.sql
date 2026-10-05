delete from schema_migrations where version = '0002_project_manifests';
drop index if exists projects_machine_status_idx;
alter table projects
  drop column if exists version,
  drop column if exists manifest,
  drop column if exists manifest_version;
