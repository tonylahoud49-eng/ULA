-- Employee privacy and tamper-evident database activity controls.
-- Apply after 001_production_rls.sql with the migration owner role.

begin;

-- A leave request must always refer to the authenticated employee.  The
-- application service sets app.user_id for every transaction; administrators
-- retain their deliberate management access.
drop policy if exists leave_insert on ula.leave_requests;
create policy leave_insert on ula.leave_requests for insert with check (
  user_id = ula.current_actor_id()
  and exists (
    select 1 from ula.employees e
    where e.id = employee_id and e.user_id = ula.current_actor_id()
  )
);

-- Employees may only amend their own still-pending request.  The workflow
-- endpoint, not the generic entity endpoint, performs any update.
drop policy if exists leave_update on ula.leave_requests;
create policy leave_update on ula.leave_requests for update using (
  ula.current_actor_is_admin()
  or (user_id = ula.current_actor_id() and coalesce(data->>'status', 'Pending') = 'Pending')
) with check (
  ula.current_actor_is_admin()
  or (
    user_id = ula.current_actor_id()
    and exists (
      select 1 from ula.employees e
      where e.id = employee_id and e.user_id = ula.current_actor_id()
    )
    and coalesce(data->>'status', 'Pending') = 'Pending'
  )
);

-- Employee accounts and balances are provisioned and maintained by an admin.
-- This prevents a new browser session from creating a balance for itself.
drop policy if exists employee_insert on ula.employees;
create policy employee_insert on ula.employees for insert with check (ula.current_actor_is_admin());

-- Persist every successful insert, update and delete independently of the API
-- implementation.  Read/download events are recorded by the repository,
-- because PostgreSQL has no SELECT trigger.
create or replace function ula.audit_row_change() returns trigger
language plpgsql
security definer
set search_path = ula, pg_catalog
as $$
declare
  row_data jsonb;
  prior_data jsonb;
  record_label text;
begin
  row_data := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  prior_data := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  record_label := coalesce(
    row_data->'data'->>'claim_number', row_data->'data'->>'title', row_data->'data'->>'employee_name', row_data->'data'->>'name', row_data->'data'->>'file_name',
    prior_data->'data'->>'claim_number', prior_data->'data'->>'title', prior_data->'data'->>'employee_name', prior_data->'data'->>'name', prior_data->'data'->>'file_name'
  );
  insert into ula.audit_log (
    id, actor_id, actor_role, action, entity, record_id, record_label, before_value, after_value
  ) values (
    md5(random()::text || clock_timestamp()::text || txid_current()::text)::uuid,
    coalesce(nullif(current_setting('app.user_id', true), ''), current_user),
    coalesce(nullif(current_setting('app.user_role', true), ''), 'system'),
    lower(tg_op),
    case tg_table_name
      when 'employees' then 'Employee'
      when 'claims' then 'Claim'
      when 'claim_documents' then 'ClaimDocument'
      when 'report_versions' then 'ReportVersion'
      when 'leave_requests' then 'Leave'
      else tg_table_name
    end,
    coalesce(row_data->>'id', prior_data->>'id'),
    record_label,
    prior_data,
    row_data
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_employees_change on ula.employees;
create trigger audit_employees_change after insert or update or delete on ula.employees
for each row execute function ula.audit_row_change();
drop trigger if exists audit_claims_change on ula.claims;
create trigger audit_claims_change after insert or update or delete on ula.claims
for each row execute function ula.audit_row_change();
drop trigger if exists audit_claim_documents_change on ula.claim_documents;
create trigger audit_claim_documents_change after insert or update or delete on ula.claim_documents
for each row execute function ula.audit_row_change();
drop trigger if exists audit_report_versions_change on ula.report_versions;
create trigger audit_report_versions_change after insert or update or delete on ula.report_versions
for each row execute function ula.audit_row_change();
drop trigger if exists audit_leave_requests_change on ula.leave_requests;
create trigger audit_leave_requests_change after insert or update or delete on ula.leave_requests
for each row execute function ula.audit_row_change();

commit;
