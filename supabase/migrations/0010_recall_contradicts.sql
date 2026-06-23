-- Surface the contradiction flag through recall so the UI/agent can show "conflicts with N
-- other memories". Same body as 0009-era recall_memory_hybrid, plus `contradicts` in the
-- return shape. Must DROP first: adding a column to the RETURNS TABLE changes the OUT-param row
-- type, which create-or-replace rejects. No behaviour change to ranking.
drop function if exists recall_memory_hybrid(uuid, text, vector, integer);
create function recall_memory_hybrid(p uuid, q text, qe vector(384) default null, k int default 40)
returns table (
  id uuid, project_id uuid, author_member_id uuid, author_kind text, source_tool text,
  text text, file_paths text[], branch text, tags text[], status text, confidence real,
  superseded_by uuid, content_hash text, contradicts uuid[], created_at timestamptz,
  last_referenced_at timestamptz, expires_at timestamptz, archived_at timestamptz,
  fts_rank real, semantic_sim real
)
language sql stable security definer
set search_path = public
as $$
  with active as (
    select m.* from memory m
    where m.project_id = p
      and m.archived_at is null
      and m.superseded_by is null
      and (m.expires_at is null or m.expires_at > now())
  ),
  scored as (
    select a.*,
      case when coalesce(q, '') = '' then 0
           else ts_rank(a.fts, websearch_to_tsquery('english', q)) end::real as fts_rank,
      case when qe is not null and a.embedding is not null then (1 - (a.embedding <=> qe))
           else 0 end::real as semantic_sim
    from active a
  )
  select id, project_id, author_member_id, author_kind, source_tool, text, file_paths, branch,
         tags, status, confidence, superseded_by, content_hash, contradicts, created_at,
         last_referenced_at, expires_at, archived_at, fts_rank, semantic_sim
  from scored
  order by greatest(fts_rank, semantic_sim) desc, created_at desc
  limit k;
$$;
