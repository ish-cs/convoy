create extension if not exists vector;

create table memory (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  author_member_id uuid not null references project_members(id) on delete cascade,
  author_kind text not null default 'human' check (author_kind in ('human','agent')),
  source_tool text not null default 'web',
  text text not null,
  file_paths text[] not null default '{}',
  branch text,
  tags text[] not null default '{}',
  status text not null default 'confirmed' check (status in ('confirmed','unconfirmed')),
  confidence real not null default 1.0,
  superseded_by uuid references memory(id) on delete set null,
  content_hash text not null,
  fts tsvector,
  embedding vector(384),
  created_at timestamptz not null default now(),
  last_referenced_at timestamptz,
  expires_at timestamptz,
  archived_at timestamptz
);

-- fts is maintained by a trigger (a generated column rejects to_tsvector(regconfig,...)
-- as "not immutable"). Behaviour is identical: text + tags are searchable.
create function memory_fts_update() returns trigger language plpgsql as $$
begin
  new.fts := to_tsvector('english', coalesce(new.text,'') || ' ' || array_to_string(new.tags,' '));
  return new;
end $$;
create trigger memory_fts_trg before insert or update of text, tags on memory
  for each row execute function memory_fts_update();

create index memory_fts_idx on memory using gin(fts);
create index memory_files_idx on memory using gin(file_paths);
create index memory_embedding_idx on memory using hnsw (embedding vector_cosine_ops);
create index memory_project_idx on memory(project_id, created_at desc);
create unique index memory_dedup_idx on memory(project_id, content_hash) where archived_at is null;

alter table memory enable row level security;
-- browser surface: member of the project via auth session
create policy memory_select on memory for select using (exists (
  select 1 from project_members m where m.project_id = memory.project_id
    and m.user_id = auth.uid() and m.revoked_at is null));
create policy memory_insert on memory for insert with check (exists (
  select 1 from project_members m where m.project_id = memory.project_id
    and m.user_id = auth.uid() and m.revoked_at is null));
create policy memory_update on memory for update using (exists (
  select 1 from project_members m where m.project_id = memory.project_id
    and m.user_id = auth.uid() and m.revoked_at is null));
