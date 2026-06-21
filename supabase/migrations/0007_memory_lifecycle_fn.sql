-- Supersede: insert the replacement memory and point the old row at it, atomically.
-- security definer + explicit project scoping so token-authed callers work.
create or replace function supersede_memory(
  p_old uuid, p_project uuid, p_author uuid, p_kind text, p_source text,
  p_text text, p_files text[], p_branch text, p_tags text[], p_hash text
) returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  insert into memory(project_id, author_member_id, author_kind, source_tool, text,
                     file_paths, branch, tags, confidence, content_hash)
  values (p_project, p_author, p_kind, p_source, p_text, p_files, p_branch, p_tags,
          case when p_kind = 'human' then 1.0 else 0.6 end, p_hash)
  returning id into new_id;
  update memory set superseded_by = new_id
    where id = p_old and project_id = p_project and superseded_by is null;
  return new_id;
end $$;
