-- Shared operational settings used by server-side workflows.

begin;

-- Administrators may submit on behalf of an employee, while ordinary users
-- remain restricted to their own linked employee record.
drop policy if exists leave_insert on ula.leave_requests;
create policy leave_insert on ula.leave_requests for insert with check (
  ula.current_actor_is_admin()
  or (
    user_id = ula.current_actor_id()
    and exists (
      select 1 from ula.employees e
      where e.id = employee_id and e.user_id = ula.current_actor_id()
    )
  )
);

create table if not exists ula.app_settings (
  key text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table ula.app_settings enable row level security;
alter table ula.app_settings force row level security;

drop policy if exists app_settings_select on ula.app_settings;
create policy app_settings_select on ula.app_settings for select using (
  ula.current_actor_id() is not null
);

drop policy if exists app_settings_insert on ula.app_settings;
create policy app_settings_insert on ula.app_settings for insert with check (
  ula.current_actor_is_admin()
);

drop policy if exists app_settings_update on ula.app_settings;
create policy app_settings_update on ula.app_settings for update using (
  ula.current_actor_is_admin()
) with check (
  ula.current_actor_is_admin()
);

drop policy if exists app_settings_delete on ula.app_settings;
create policy app_settings_delete on ula.app_settings for delete using (
  ula.current_actor_is_admin()
);

drop trigger if exists audit_app_settings_change on ula.app_settings;
create trigger audit_app_settings_change after insert or update or delete on ula.app_settings
for each row execute function ula.audit_row_change();

commit;
