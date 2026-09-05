begin;

create table if not exists ula.auth_users (
  id text primary key,
  email text not null unique,
  full_name text not null,
  job_title text not null default '',
  password_hash text not null,
  password_status text not null default 'set',
  status text not null default 'approved' check (status in ('approved', 'revoked')),
  role text not null default 'user' check (role in ('admin', 'user', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ula.auth_sessions (
  token_hash text primary key,
  user_id text not null references ula.auth_users(id) on delete cascade,
  expires_at timestamptz not null
);

create table if not exists ula.password_reset_requests (
  token_hash text primary key,
  user_id text not null references ula.auth_users(id) on delete cascade,
  expires_at timestamptz not null
);

create index if not exists auth_sessions_user_id_idx on ula.auth_sessions(user_id);
create index if not exists auth_sessions_expires_at_idx on ula.auth_sessions(expires_at);
create index if not exists password_reset_expires_at_idx on ula.password_reset_requests(expires_at);

-- Replace placeholders with the actual runtime role before applying.
-- grant usage on schema ula to ula_app;
-- grant select, insert, update, delete on all tables in schema ula to ula_app;
-- grant usage, select on all sequences in schema ula to ula_app;
-- alter default privileges for role ula_migrator in schema ula grant select, insert, update, delete on tables to ula_app;

commit;