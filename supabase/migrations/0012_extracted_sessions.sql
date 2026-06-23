-- T11 idempotency. content_hash dedup alone does NOT make re-extraction safe: the LLM rephrases
-- the same fact on a second run, producing a new content_hash that slips past dedup as a near-
-- duplicate (observed live). Track which sessions have been extracted and skip them outright.
create table if not exists extracted_sessions (
  project_id uuid not null references projects(id) on delete cascade,
  session_id text not null,
  drafted int not null default 0,
  extracted_at timestamptz not null default now(),
  primary key (project_id, session_id)
);
