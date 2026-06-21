create extension if not exists pgcrypto;

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  display_name text,
  current_summary text,
  summary_updated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, email)
);

create table member_status (
  member_id uuid not null references project_members(id) on delete cascade,
  session_id text not null,
  project_id uuid not null references projects(id) on delete cascade,
  branch text,
  files text[] not null default '{}',
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (member_id, session_id)
);

create table events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  member_id uuid not null references project_members(id) on delete cascade,
  session_id text not null,
  ts timestamptz not null default now(),
  branch text,
  files text[] not null default '{}',
  message text not null
);
create index events_project_ts_idx on events(project_id, ts desc);
