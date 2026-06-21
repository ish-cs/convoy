alter table projects enable row level security;
alter table project_members enable row level security;
alter table member_status enable row level security;
alter table events enable row level security;

create or replace function is_project_member(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from projects where id = p and owner_id = auth.uid())
      or exists (select 1 from project_members where project_id = p and user_id = auth.uid());
$$;

create policy projects_owner_all on projects
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy projects_member_read on projects
  for select using (is_project_member(id));
create policy members_read on project_members
  for select using (is_project_member(project_id));
create policy members_owner_write on project_members
  for all using (exists (select 1 from projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from projects p where p.id = project_id and p.owner_id = auth.uid()));
create policy status_read on member_status for select using (is_project_member(project_id));
create policy events_read on events for select using (is_project_member(project_id));
-- machine writes (ingest/mcp) use the service role and bypass RLS.
