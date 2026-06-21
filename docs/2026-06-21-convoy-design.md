# Convoy — Shared Live Context for Claude Code Teams

**Status:** Design v2 (approved direction, pre-implementation)
**Date:** 2026-06-21
**Working name:** Convoy (placeholder)

> v2 changes (from adversarial review): writes flow through a capture **hook**, not the model;
> status is **per-session** (`session_id`) not per-member; onboarding is one `npx convoy-cli connect`
> command; invitees get a **Resend email**; member **roster + revoke** UI; overlap unions
> recent-event files. See "What changed in v2" at the end.

---

## Problem

Two+ developers work together in Claude Code on different branches, sometimes on conflicting
code. Each Claude Code session is context-isolated — one person's agent can't see what the
other's is doing. Today they relay context manually over iMessage: slow, lossy, doesn't scale.

Existing tools (Hivemind, MemNexus, evalops/shared-memory-mcp, Claude Code's leaked native team
memory) are **fact/knowledge stores** and agent-only. None do **branch-aware live coordination**
("I'm editing `auth.ts` on `feat/x` right now") with a human-facing live view.

## Goal

A web app: sign in with Google, create a project, invite teammates by email. Each teammate runs
one command in their terminal. From then on their Claude Code sessions automatically publish what
they're working on (branch + files, captured by a hook) and can read teammates' live state with
**active file-overlap alerts** — all watchable in the browser in real time.

## Decisions (locked)

| Pivot | Decision |
|---|---|
| Scope | Small product, ship publicly |
| Data model | Hybrid: per-**session** status + append-only activity log |
| Capture | **Hook-driven writes** (accurate, automatic) + MCP read; optional MCP summary |
| Conflict | **Active overlap alerts**, branch + file level — the differentiator |
| Onboarding | One command: `npx convoy-cli connect <token>` (installs MCP + hooks) |
| Auth | Google OAuth only |
| Invites | Resend email to invitee |
| UI | Plain-but-clean Tailwind v1; Liquid Glass later |
| Supabase | New dedicated project |
| Overlap window | 60 minutes |

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Web app · Next 16 + Supabase + Vercel                           │
│  • Google sign-in  • create project  • invite by email (Resend)  │
│  • live view: per-session status cards + activity feed + alerts   │
│  • member roster (connected/pending) + revoke                     │
│  • serves /install + /api/ingest + /mcp                           │
└───────────┬──────────────────────────────┬───────────────────────┘
            │ Supabase Postgres + Realtime  │
            │ projects · project_members ·  │
            │ member_status(session) · events                       │
   ┌────────┴─────────┐            ┌─────────┴──────────┐
   │ /api/ingest (HTTP)│            │ /mcp (HTTP MCP)    │
   │ token-authed      │            │ token-authed       │
   │ ← hook POSTs      │            │ • pull_team_context│ ← Claude reads
   │   edits/branch/   │            │ • set_my_status    │   (+ overlap alerts)
   │   session/idle    │            └─────────┬──────────┘
   └────────┬──────────┘                      │
            │                                  │
   PostToolUse + Stop hooks            Claude Code session
   (installed by `npx convoy-cli connect <token>`; the hook gets
    session_id + edited file paths on stdin, runs `git branch`, POSTs)
```

### Components (isolated, single-purpose)

1. **Web app (Next 16)** — auth, project CRUD, invites (Resend), roster/revoke, live view.
2. **`/api/ingest`** — token-authed HTTP endpoint the hook POSTs to: upserts the caller's
   per-session status, appends activity events, marks sessions idle on stop.
3. **`/mcp`** — hosted MCP (read-mostly): `pull_team_context` (returns teammates' active
   sessions + recent events + overlap alerts) and `set_my_status` (optional human summary).
4. **Overlap engine** — pure `computeOverlap(...)`, no I/O, exhaustively unit-tested.
5. **`convoy-cli`** — tiny npm CLI: `connect <token>` writes MCP config + installs the hooks +
   stores the token; `hook` is the per-event runner the hooks invoke (reads stdin, POSTs ingest).

---

## Onboarding — the "code" mechanism

The code = an opaque, **revocable per-member token**. The invitee runs once:

```bash
npx convoy-cli@latest connect <token>
```

This:
- registers the hosted MCP server (`claude mcp add --transport http convoy <url>/mcp -H "Authorization: Bearer <token>"`),
- installs a `PostToolUse` hook (on Edit/Write/MultiEdit) and a `Stop` hook into Claude Code settings,
- stores the token at `~/.convoy/token`.

The hooks call `convoy-cli hook`, which reads the hook payload on stdin (`session_id`, tool input
file paths), runs `git branch --show-current` in `cwd`, and POSTs to `/api/ingest`. Revoking the
token from the web instantly 401s both `/api/ingest` and `/mcp`.

> Portability note (v1): `convoy-cli` assumes Node on the teammate's machine (true for us). The
> MCP endpoint stays hosted; only the thin CLI/hook runs locally — unavoidable, since a hook
> needs a local executable.

---

## Data model (Postgres)

| Table | Key fields | Purpose |
|---|---|---|
| `projects` | id, name, owner_id, created_at | the workspace |
| `project_members` | id, project_id, user_id, email, token, display_name, current_summary, summary_updated_at, revoked_at | who + token + optional Claude-set summary |
| `member_status` | **(member_id, session_id)** pk, project_id, branch, files[], ended_at, updated_at | one row per active **session** (hook-written) |
| `events` | id, project_id, member_id, session_id, ts, branch, files[], message | append-only activity log |

Notes:
- **Per-session status** solves concurrent sessions: one person on two branches = two rows.
- `ended_at` set by the `Stop` hook → UI marks the session idle; overlap ignores ended/stale sessions.
- `current_summary` lives on the member (MCP `set_my_status` can't know `session_id`), shown next
  to that member's most-recent active session.
- `events` insert-only, retained, paginated.

---

## Capture hook (the wedge's fuel)

- **PostToolUse** (Edit/Write/MultiEdit): payload → `{session_id, files:[path], branch}` →
  `POST /api/ingest {kind:'edit'}` → upserts `member_status[(member,session)]` with branch +
  unioned files, appends an `events` row.
- **Stop**: `POST /api/ingest {kind:'idle', session_id}` → sets `member_status.ended_at = now()`.

This makes overlap data **accurate (real edited files) and live (on every edit)** without relying
on the model to self-report.

---

## MCP tools (read-mostly)

| Tool | Input | Returns / effect |
|---|---|---|
| `pull_team_context` | `branch?`, `files?` | `{ members: [active-session status + summary], recent_events, alerts }` |
| `set_my_status` | `summary` | sets caller's `current_summary` (optional human-readable intent) |

Server instructions tell Claude to call `pull_team_context` at session start and before editing
files (passing current branch + files it's about to touch), and optionally `set_my_status` when
starting a task. (File/branch/activity capture is automatic via the hook — the model isn't relied
on for it.)

---

## Overlap alerts (the wedge)

`pull_team_context` intersects the caller's `(branch, files)` against **other members' active
sessions** — using each session's `files` **unioned with that member's recent event files**
(within the 60-min window) — and returns `alerts[]`:

> ⚠️ Partner is editing `auth.ts` on `feat/y` (3 min ago) — you're also touching it.

Branch + file level. The pure `computeOverlap` function is unit-tested exhaustively.

---

## Live web view

Supabase Realtime on `member_status` + `events`:
- per-session status cards (member, branch, files, idle badge if ended/stale),
- activity feed,
- red overlap banners across active sessions,
- member roster: connected vs pending (invited, never connected), with a revoke button (owner).

Plain Tailwind v1.

---

## Email invites

On invite, after inserting the pending member, send a Resend email: "You've been added to
{project} on Convoy — sign in with this email and run one command." Contains the sign-in link.

---

## Security

- Humans: Supabase Auth (Google).
- Machine paths (`/mcp`, `/api/ingest`): opaque revocable bearer token → member; not-revoked check.
- RLS isolates the web read path per project; machine paths use the service role with manual
  token→member scoping.
- Loud "never put secrets in shared context" warning in UI + tool/hook docs.
- Token stored locally at `~/.convoy/token` (like any API key); revoke kills access immediately.

## Error handling

- Invalid/revoked token → 401 (both endpoints), loud.
- Hook failures must **never block** the user's edit — the hook POSTs best-effort, short timeout,
  swallows network errors (logs locally), exits 0.
- Tool/ingest DB errors → throw loud with useful messages.
- Web view shows "last synced" so staleness is visible.

## Out of scope (YAGNI, v1)

Billing · roles beyond owner/member · Cursor/Codex support · semantic search · summarization of
sessions · non-Node teammate support (hook assumes Node).

## Testing

- Unit: `computeOverlap` (exhaustive); ingest upsert/union logic; MCP tool handlers.
- RLS: a token/user can't read another project.
- E2E (Playwright): seed a Supabase session for a test user (do **not** automate Google);
  drive ingest for two members on the same file; assert the overlap banner renders.

---

## What changed in v2 (from the adversarial review)

| Gap found | Fix in v2 |
|---|---|
| Overlap wedge depended on a deferred hook | Hook is now core; writes flow through it via `/api/ingest` |
| No email to invitees | Resend email on invite |
| No roster / revoke UI | Member roster + revoke button in the live view |
| Concurrent sessions clobbered one status row | Status keyed per `session_id` |
| No idle/session-end concept | `Stop` hook sets `ended_at`; UI shows idle |
| E2E couldn't automate Google | Seed a Supabase session instead |
| `mcp-handler` Redis dependency unknown | Verified/stateless-or-Redis decided in the MCP task |
| Overlap ignored event files | Overlap unions session files with recent event files |
