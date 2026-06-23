-- T10: contradiction flags + recency bump.
-- `contradicts` holds ids of active memories that conflict with this one (same topic, different
-- text). Populated at embed-backfill time (the write path never embeds — Global Constraints),
-- surfaced for human resolution. Default empty so existing rows are unaffected.
alter table memory add column if not exists contradicts uuid[] not null default '{}';

-- Recency bump: set last_referenced_at = now() for the memories a recall surfaced. security
-- definer so the call works under RLS regardless of caller; additive (never blocks recall).
create or replace function touch_memories(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update memory set last_referenced_at = now() where id = any(p_ids);
$$;
