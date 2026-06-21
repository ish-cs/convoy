-- Active-only memory recall for a project. FTS-ranked when q is non-empty, else newest.
-- security definer with an explicit project_id = p filter so token-authed callers
-- (which resolve their own project id) work without relying on auth.uid().
create or replace function recall_memory(p uuid, q text)
returns setof memory
language sql stable security definer
set search_path = public
as $$
  select m.* from memory m
  where m.project_id = p
    and m.archived_at is null
    and m.superseded_by is null
    and (m.expires_at is null or m.expires_at > now())
    and (coalesce(q, '') = '' or m.fts @@ websearch_to_tsquery('english', q))
  order by
    case when coalesce(q, '') = '' then 0
         else ts_rank(m.fts, websearch_to_tsquery('english', q)) end desc,
    m.created_at desc
  limit 20;
$$;
