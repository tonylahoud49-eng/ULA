-- ULA production data model and row-level security.
-- Run with a dedicated migration role. The application role must NOT have
-- BYPASSRLS, superuser, or table-owner privileges.

begin;

create schema if not exists ula;

create or replace function ula.current_actor_id() returns text
language sql stable as $$ select nullif(current_setting('app.user_id', true), '') $$;

create or replace function ula.current_actor_is_admin() returns boolean
language sql stable as $$ select current_setting('app.user_role', true) = 'admin' $$;

create table if not exists ula.employees (
  id text primary key,
  user_id text not null unique,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ula.claims (
  id text primary key,
  owner_id text not null,
  visibility text not null check (visibility in ('private', 'public')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ula.claim_documents (
  id text primary key,
  claim_id text not null references ula.claims(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ula.report_versions (
  id text primary key,
  claim_id text not null references ula.claims(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ula.leave_requests (
  id text primary key,
  employee_id text not null references ula.employees(id) on delete restrict,
  user_id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ula.audit_log (
  id uuid primary key,
  actor_id text not null,
  actor_role text not null,
  action text not null,
  entity text not null,
  record_id text,
  record_label text,
  before_value jsonb,
  after_value jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists claims_owner_id_idx on ula.claims(owner_id);
create index if not exists claims_visibility_idx on ula.claims(visibility);
create index if not exists claim_documents_claim_id_idx on ula.claim_documents(claim_id);
create index if not exists report_versions_claim_id_idx on ula.report_versions(claim_id);
create index if not exists leave_requests_user_id_idx on ula.leave_requests(user_id);
create index if not exists audit_log_occurred_at_idx on ula.audit_log(occurred_at desc);

-- No application principal may bypass these policies. The migration role should
-- be separate from the runtime application role.
alter table ula.employees enable row level security;
alter table ula.claims enable row level security;
alter table ula.claim_documents enable row level security;
alter table ula.report_versions enable row level security;
alter table ula.leave_requests enable row level security;
alter table ula.audit_log enable row level security;
alter table ula.employees force row level security;
alter table ula.claims force row level security;
alter table ula.claim_documents force row level security;
alter table ula.report_versions force row level security;
alter table ula.leave_requests force row level security;
alter table ula.audit_log force row level security;

drop policy if exists employee_select on ula.employees;
create policy employee_select on ula.employees for select using (ula.current_actor_is_admin() or user_id = ula.current_actor_id());
drop policy if exists employee_insert on ula.employees;
create policy employee_insert on ula.employees for insert with check (ula.current_actor_is_admin() or user_id = ula.current_actor_id());
drop policy if exists employee_update on ula.employees;
create policy employee_update on ula.employees for update using (ula.current_actor_is_admin()) with check (ula.current_actor_is_admin());
drop policy if exists employee_delete on ula.employees;
create policy employee_delete on ula.employees for delete using (ula.current_actor_is_admin());

drop policy if exists claim_select on ula.claims;
create policy claim_select on ula.claims for select using (ula.current_actor_is_admin() or owner_id = ula.current_actor_id() or visibility = 'public');
drop policy if exists claim_insert on ula.claims;
create policy claim_insert on ula.claims for insert with check (owner_id = ula.current_actor_id() and visibility in ('private', 'public'));
drop policy if exists claim_update on ula.claims;
create policy claim_update on ula.claims for update using (ula.current_actor_is_admin() or owner_id = ula.current_actor_id()) with check (ula.current_actor_is_admin() or owner_id = ula.current_actor_id());
drop policy if exists claim_delete on ula.claims;
create policy claim_delete on ula.claims for delete using (ula.current_actor_is_admin() or owner_id = ula.current_actor_id());

drop policy if exists document_access on ula.claim_documents;
drop policy if exists document_write on ula.claim_documents;
create policy document_access on ula.claim_documents for select using (exists (select 1 from ula.claims c where c.id = claim_id));
create policy document_write on ula.claim_documents for all using (ula.current_actor_is_admin() or exists (select 1 from ula.claims c where c.id = claim_id and c.owner_id = ula.current_actor_id())) with check (ula.current_actor_is_admin() or exists (select 1 from ula.claims c where c.id = claim_id and c.owner_id = ula.current_actor_id()));
drop policy if exists report_access on ula.report_versions;
drop policy if exists report_write on ula.report_versions;
create policy report_access on ula.report_versions for select using (exists (select 1 from ula.claims c where c.id = claim_id));
create policy report_write on ula.report_versions for all using (ula.current_actor_is_admin() or exists (select 1 from ula.claims c where c.id = claim_id and c.owner_id = ula.current_actor_id())) with check (ula.current_actor_is_admin() or exists (select 1 from ula.claims c where c.id = claim_id and c.owner_id = ula.current_actor_id()));

drop policy if exists leave_select on ula.leave_requests;
create policy leave_select on ula.leave_requests for select using (ula.current_actor_is_admin() or user_id = ula.current_actor_id());
drop policy if exists leave_insert on ula.leave_requests;
create policy leave_insert on ula.leave_requests for insert with check (user_id = ula.current_actor_id());
drop policy if exists leave_update on ula.leave_requests;
create policy leave_update on ula.leave_requests for update using (ula.current_actor_is_admin() or (user_id = ula.current_actor_id() and coalesce(data->>'status', 'Pending') = 'Pending')) with check (ula.current_actor_is_admin() or user_id = ula.current_actor_id());
drop policy if exists leave_delete on ula.leave_requests;
create policy leave_delete on ula.leave_requests for delete using (ula.current_actor_is_admin());

drop policy if exists audit_select on ula.audit_log;
create policy audit_select on ula.audit_log for select using (ula.current_actor_is_admin());
drop policy if exists audit_insert on ula.audit_log;
create policy audit_insert on ula.audit_log for insert with check (actor_id = ula.current_actor_id());
-- Intentionally no UPDATE or DELETE policy: audit history is append-only.

commit;
