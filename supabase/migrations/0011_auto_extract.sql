-- T11: auto-extract proposer (confirm-to-keep).
-- Per-project opt-in — extraction is OFF unless a project turns it on.
alter table projects add column if not exists auto_extract boolean not null default false;

-- Reference counter for auto-confirm: an unconfirmed (machine-proposed) memory that gets
-- surfaced/used twice is promoted to confirmed — the team voted with their attention.
alter table memory add column if not exists ref_count int not null default 0;

-- touch_memories now does double duty (still additive, still security definer): bump recency,
-- count the reference, and auto-confirm an unconfirmed memory once it has been referenced twice.
create or replace function touch_memories(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update memory
     set last_referenced_at = now(),
         ref_count = ref_count + 1,
         status = case when status = 'unconfirmed' and ref_count + 1 >= 2 then 'confirmed' else status end
   where id = any(p_ids);
$$;
