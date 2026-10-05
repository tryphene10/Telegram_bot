alter table approvals
  add column proof_method text
    constraint approvals_proof_method_check check (proof_method is null or proof_method in ('TELEGRAM_CONFIRM', 'PIN_VERIFIED')),
  add column authorization_id uuid unique,
  add column consumed_at timestamptz,
  add column version integer not null default 1
    constraint approvals_version_check check (version > 0);

alter table approvals
  add constraint approvals_consumption_consistency_check check (
    consumed_at is null or (status = 'APPROVED' and authorization_id is not null)
  );

create index approvals_authorized_unconsumed_idx
  on approvals(authorization_id)
  where status = 'APPROVED' and consumed_at is null;

insert into schema_migrations(version) values ('0003_approval_consumption');
