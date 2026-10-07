begin;
create table if not exists ula.brain_reports (
  id text primary key,
  data jsonb not null,
  original bytea not null,
  created_at timestamptz not null default now()
);
alter table ula.brain_reports enable row level security;
alter table ula.brain_reports force row level security;
create policy brain_admin on ula.brain_reports for all
  using (ula.current_actor_is_admin()) with check (ula.current_actor_is_admin());
commit;
