# Convoy Memory Layer — Design

**Status:** Design (approved direction, pre-implementation)
**Date:** 2026-06-21
**Depends on:** Convoy v2 (Phases 0–6 in `docs/2026-06-21-convoy-plan.md`)
**Builds on:** overlap engine (Phase 2), capture hook (Phase 3), MCP read endpoint (Phase 4)

> Coordination note: this design is written by the auditor session while the build session
> is mid-implementation on the same repo. Implement only after the base plan reaches Phase 4,
> or in a worktree, to avoid file collisions.

---

## Why

Convoy v2 is **live coordination only** — it shows who's editing what *right now*, then forgets
everything when the session ends. That makes it sharp but forgettable: nothing persists, nothing
compounds, nothing keeps a team locked in.

The memory layer adds the part that compounds. The same event stream Convoy already captures for
live alerts becomes the team's permanent record, and teams can deliberately save decisions that
resurface at exactly the right moment.

Two things, one substrate:

- **A — Decision/knowledge memory (headline):** people save "we decided X / we tried Y, it broke /
  auth lives in `src/auth.ts`." It comes back when relevant.
- **B — Activity timeline (substrate):** the live event stream is persisted instead of discarded,
  so the live view becomes scrollable into the past.

## Decisions (locked)

| Question | Decision | Why |
|---|---|---|
| Capture | **Explicit only.** Agent calls a `remember` tool; human pins a note in the UI. | High signal, no wrong-fact embarrassment. No LLM auto-extract (the Augur `user_facts` pain). |
| Retrieval | **Both.** A `recall` MCP tool for lookups **+** auto-attach memory to overlap alerts. | Auto-attach is the "holy shit" demo; reuses Phase 2 + Phase 4 machinery. |
| Keying | **File paths first-class, tags + text optional.** | File match = a join into the overlap engine (nearly free). Tags/text feed `recall`. |
| Storage | **Own Postgres (Supabase) + FTS.** No embeddings, no third-party memory vendor. | Memory is the moat — own it. No new latency, no per-token billing, no platform risk. |

Explicitly **not** doing now: LLM auto-extraction, semantic/vector search, third-party memory
services (e.g. Supermemory). Those are the upgrade path if/when we add a semantic team brain.

## Data model

Two tables, both scoped to a project and protected by the same RLS pattern as the rest of Convoy.

**`memory`** — the decision/knowledge store (A)
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `project_id` | uuid fk | RLS scope |
| `author_member_id` | uuid fk | who saved it (agent or human) |
| `text` | text | the note itself |
| `file_paths` | text[] | files this memory is about (drives auto-surface) |
| `tags` | text[] | optional topics for `recall` |
| `fts` | tsvector (generated) | over `text` + `tags`, GIN-indexed |
| `created_at` | timestamptz | |
| `archived_at` | timestamptz null | soft delete |

**`activity`** — the persisted event timeline (B)
This is the same shape the capture hook already emits for live status; we just stop throwing it
away. Append-only; the live view reads the recent tail, history reads further back.
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `project_id` | uuid fk | |
| `session_id` | text | |
| `member_id` | uuid fk | |
| `branch` | text | |
| `file_paths` | text[] | |
| `created_at` | timestamptz | indexed for tail + range reads |

> B is genuinely cheap: the Phase 3 ingest path already writes per-session status. Memory adds one
> `insert into activity` next to the existing status upsert.

## Interfaces

**Write (explicit only):**
- `remember({ text, file_paths?, tags? })` — MCP tool, agent-callable. Inserts one `memory` row.
- Web UI "pin a note" form — same insert, human-authored.

**Read:**
- `recall({ query })` — MCP tool. Postgres FTS over `memory.fts`, filtered to the caller's
  project, newest-first. Returns text + file_paths + tags + author.
- **Auto-attach (the star):** when the overlap engine fires an alert for a set of files, it also
  selects `memory` rows whose `file_paths` intersect those files (`&&` array overlap) and attaches
  them to the alert — both in `pull_team_context` (agent) and the live banner (human). Pure join on
  data both sides already have. No new search, no new surface.
- History view — web UI reads `activity` by time range for a scrollable past.

## Data flow

```
agent/human ──remember()──▶ memory table
                                  │
overlap engine (Phase 2) ── files ─┤
                                  ▼
       file_paths && alert.files  ──▶ alert + attached memory
                                          │
                                          ├─▶ pull_team_context (agent)
                                          └─▶ live banner (human)

capture hook (Phase 3) ──event──▶ activity table ──▶ live view (tail) + history (range)
```

## Error handling

- `remember` with empty `text` → reject with a clear message. `file_paths`/`tags` optional.
- `recall` with no matches → return empty list, not an error.
- Auto-attach is best-effort: if the memory select fails, the overlap alert still fires (memory is
  additive, never blocks coordination).
- Archived memories (`archived_at` set) are excluded from both `recall` and auto-attach.

## Testing

- **Pure:** `recall` FTS ranking; array-overlap match for auto-attach (unit-testable like the
  existing overlap engine — no DB needed for the matching logic).
- **Integration (local Supabase):** RLS — a member cannot read another project's memory or
  activity; `remember`/`recall` round-trip; auto-attach returns the right memory for a given file
  set.
- **E2E:** save a note about `auth.ts` on one machine → second machine edits `auth.ts` → the saved
  note appears attached to the overlap alert in both the agent response and the browser banner.

## Build order

1. `memory` + `activity` tables + RLS migration.
2. Persist `activity` in the existing Phase 3 ingest path (one insert).
3. `remember` MCP tool + web pin form.
4. `recall` MCP tool (FTS).
5. Auto-attach: join memory into the overlap alert (agent + banner).
6. History view in the live page.
7. E2E + tests.

## Upgrade path (not now)

If teams later want a brain that figures out decisions on its own from chat/docs, add LLM
auto-extract feeding the same `memory` table, and/or a semantic backend (own pgvector or a vendor
like Supermemory). The schema above doesn't block it — `text` + `tags` are already there to embed.
