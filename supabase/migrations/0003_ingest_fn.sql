create or replace function ingest_edit(
  p_member uuid, p_session text, p_project uuid,
  p_branch text, p_files text[], p_message text
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into member_status (member_id, session_id, project_id, branch, files, ended_at, updated_at)
  values (p_member, p_session, p_project, p_branch, p_files, null, now())
  on conflict (member_id, session_id) do update
    set branch = excluded.branch,
        files = (select array(select distinct unnest(member_status.files || excluded.files))),
        ended_at = null,
        updated_at = now();
  insert into events (project_id, member_id, session_id, branch, files, message)
  values (p_project, p_member, p_session, p_branch, p_files, p_message);
end; $$;
