# Convoy Memory Layer — Design

**Status:** Design v2 (approved direction, pre-implementation)
**Date:** 2026-06-21
**Depends on:** Convoy v1 (shipped — Phases 0–7 of `docs/2026-06-21-convoy-plan.md`)
**Builds on:** overlap engine (`src/lib/overlap.ts`), token-authed ingest (`/api/ingest`), MCP endpoint (`app/mcp/route.ts`), realtime live view.

> Coordination note: written by the auditor session. Convoy v1 is shipped, so this no longer races
> the build. Implement on a branch/worktree; the build terminal or a fresh session executes the plan.

---

## Stance: lead in memory, don't bolt it on

Convoy v1 wins on **live coordination** — who's editing what, right now. That's a sharp wedge but a
copyable one. Memory is not a feature we attach; it is the layer we intend to be **best in the world
at**, because it is the only part that compounds and the only part a team would mourn if it vanished.

"Leading" has a concrete bar, not a vibe (see *The bar* below). Two strategic risks shape the whole
design, and each has a built-in answer:

### Risk 1 — "dumb memory gets out-featured"
A v1 that only does explicit-save + exact-file-name match is easy to beat with smarter auto-memory.

**Answer: coordination-native *hybrid* retrieval, in our own Postgres.**
- Retrieval fuses three signals: **(a) file-path join** (exact, coordination-native — the thing
  only we have, because we know who's-editing-what), **(b) full-text** (Postgres FTS),
  **(c) semantic** (pgvector embeddings). One ranked result set.
- pgvector lives **inside Supabase Postgres** — we get semantic recall *without* renting our moat to
  a third party and without new platform risk. Embeddings are computed async on write (write path
  stays fast) and can run on a local/embedded model or a cheap API behind a single seam.
- Auto-extract exists but **proposes, never asserts**: it drafts memories that stay `unconfirmed`
  until a human/agent confirms or the note is referenced again. This sidesteps the exact noise pain
  Augur hit (13/28 factual fails before guardrails). High signal by construction.

Our durable edge is the **combination** — semantic quality *plus* coordination-native keying. A
generic memory API knows facts; it does not know that Bob is in `auth.ts` on `feat/x` right now and
that *this* decision is the one to surface. That fusion is the moat.

### Risk 2 — "Claude-only is a feature, not infrastructure"
If capture only works in Claude Code, we are a plugin, not a layer.

**Answer: a tool-agnostic ingest contract + thin adapters.**
- The write path is already a neutral, token-authed HTTP endpoint (`/api/ingest`). We formalize its
  payload as a **stable public contract** (`repo`, `branch`, `files`, `event`, optional `memory`)
  that any agent tool can post to.
- Claude Code is **one adapter** (the existing hook). Cursor, Copilot, and Codex get their own thin
  adapters posting the same contract. Memory and coordination key on `repo + branch + file` —
  nothing Claude-specific touches the core.
- Result: Convoy becomes the **neutral memory + coordination layer between every agent tool**, which
  is the infrastructure story (and the fundable one).

## The bar (what "leading" means, measured)

We hold ourselves to these or we are not leading:

| Dimension | Bar |
|---|---|
| **Recall quality** | A persona eval harness (like Augur's) scores ≥ 90% relevant-memory-surfaced on a seeded question set. Measured, in CI. |
| **No rot** | Superseded/contradicted memory never out-ranks current truth. Stale notes decay. |
| **No noise** | Auto-extract is confirm-to-keep; banner shows ≤ 3 highest-ranked memories per file. |
| **Cross-machine correctness** | The same logical file matches across macOS/Linux/Windows and different checkout roots. 0 silent misses. |
| **Safety** | Secrets are never stored; a write containing a credential is rejected with a clear reason. |
| **Latency** | Write path < 50 ms server-side (embedding is async). Recall < 200 ms p95. |
| **Tool-agnostic** | Memory captured from a non-Claude adapter is indistinguishable downstream. |

## Decisions (locked)

| Question | Decision | Why |
|---|---|---|
| Capture | **Explicit first-class; auto-extract as confirm-to-keep proposer.** | Explicit = zero wrong facts. Auto-extract adds reach without Augur's noise. |
| Retrieval | **Hybrid: file-join + FTS + semantic, fused & ranked. Auto-attach to overlap alerts + `recall` tool.** | Coordination-native keying *plus* semantic quality = the moat. |
| Keying | **Repo-relative normalized paths (first-class) + branch scope + tags + text.** | Cross-machine correctness; branch-aware truth; searchable. |
| Storage | **Own Supabase Postgres: FTS + pgvector. No third-party memory vendor.** | Own the moat; semantic without renting it. |
| Lifecycle | **create / edit / supersede / archive / expire + contradiction detection + recency-confidence ranking.** | Kills memory rot — the #1 reason memory feels bad. |
| Trust | **Human + agent authored; agent auto-extract starts `unconfirmed`; humans can confirm/correct/upvote/delete.** | Signal weighting; humans are the tiebreak. |
| Ingest | **Stable tool-agnostic contract; Claude = one adapter; Cursor/Copilot/Codex adapters next.** | Feature → infrastructure; removes platform risk. |
| Safety | **Secret-scan on write; similarity dedup.** | Never store credentials; no duplicate spam. |

Explicitly deferred (schema leaves room, not built day-one): cross-repo/org memory, fine-grained
ACLs within a project, a UI for editing embeddings/model choice.

## Data model

All tables project-scoped and RLS-protected (see *Auth correctness*). Reuses the existing `events`
table for the activity timeline (B) — only memory (A) is new storage.

**`memory`**
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `project_id` | uuid fk | RLS scope |
| `author_member_id` | uuid fk | who saved it |
| `author_kind` | text | `human` \| `agent` |
| `source_tool` | text | `claude-code` \| `cursor` \| `copilot` \| `codex` \| `web` (tool-agnostic provenance) |
| `text` | text | the note |
| `file_paths` | text[] | **repo-relative, normalized** (drives the file-join) |
| `branch` | text null | branch scope; null = applies to all branches |
| `tags` | text[] | optional topics |
| `status` | text | `confirmed` \| `unconfirmed` (auto-extract drafts) |
| `confidence` | real | 0–1; human=1.0, agent draft lower; boosts ranking |
| `superseded_by` | uuid null | points at the memory that replaced this one |
| `content_hash` | text | for dedup (normalized text + files) |
| `fts` | tsvector (generated) | over text + tags, GIN |
| `embedding` | vector(384) null | pgvector; backfilled async; nullable so write never blocks |
| `created_at` | timestamptz | |
| `last_referenced_at` | timestamptz null | bumped when surfaced/used → recency ranking |
| `expires_at` | timestamptz null | optional TTL for ephemeral notes |
| `archived_at` | timestamptz null | soft delete |

Indexes: GIN on `fts` and `file_paths`; ivfflat/hnsw on `embedding`; `(project_id, created_at desc)`;
unique-ish guard on `(project_id, content_hash)` where not archived (dedup).

## Retrieval — hybrid fusion

`recall(query, files?, branch?)` and auto-attach both run the same fused ranker:

1. **Candidates** from three sources (union):
   - file-join: `file_paths && :files` (normalized)
   - FTS: `fts @@ websearch_to_tsquery(:query)`
   - semantic: `embedding <=> :queryEmbedding` (cosine), top-K
2. **Filter:** drop `archived_at`, drop `superseded_by is not null` (superseded), drop expired,
   branch-scope (`branch is null or branch = :branch`).
3. **Score:** `w_file·fileMatch + w_fts·ftsRank + w_sem·semSim + w_recency·recencyDecay + w_conf·confidence`.
   File-match is weighted highest for auto-attach (coordination-native); semantic highest for free
   `recall`. Weights are constants in `src/lib/memory-rank.ts` and unit-tested.
4. **Cap & dedup:** top-N (banner N=3, recall N=20), drop near-duplicate `content_hash`.

The ranker is a **pure function** over candidate rows — fully unit-testable with no DB, like the
overlap engine. The DB only supplies candidates.

## Capture

- **Explicit (first-class):** `remember({ text, file_paths?, branch?, tags? })` MCP tool; web pin-note
  form. `author_kind=human` (web) or `agent` with `confidence` per source. Always `confirmed`.
- **Auto-extract (proposer):** an optional step over a finished session's `events`/messages drafts
  candidate memories with `status=unconfirmed`, low confidence, `source_tool` set. They surface
  faintly ("suggested") and only become first-class when confirmed or referenced twice. Off by
  default per project; opt-in.

## Lifecycle & anti-rot

- **Supersede:** editing a decision creates a new row and sets the old row's `superseded_by`. History
  is preserved; only current truth surfaces.
- **Contradiction detection:** on write, if a high-similarity memory exists for the same files/tags
  with materially different text, flag it for human resolution (don't silently keep both).
- **Recency decay:** ranking down-weights old, never-referenced memories; `last_referenced_at`
  refreshes relevance when a memory proves useful.
- **Expiry:** `expires_at` lets a note be deliberately ephemeral ("ignore tests on this branch today").
- **Dedup:** `content_hash` blocks re-saving the same note; near-dup detection at write time.

## Cross-machine path correctness (was overlooked)

Raw absolute paths differ per machine and OS, so memory keyed on them **silently never matches**.
Fix: a `repoRelativePath(absPath, repoRoot)` step in the **adapter** (where the git root is known)
converts every path to repo-root-relative, `/`-separated, normalized form **before** it hits the
contract. `normalizePath` (server) stays the last-mile guard. Both the overlap engine and memory key
on this canonical form, so coordination and memory agree across macOS/Linux/Windows and any checkout
location. This is a correctness requirement, tested explicitly.

## Auth correctness (fixes a real hole in the v1 plan)

Agents call MCP/ingest with a **member token**, not a Supabase auth session — so RLS policies keyed
on `auth.uid()` do **not** protect agent writes. Resolution:
- Token-authed writes (`remember` via MCP, ingest) resolve `member_id` + `project_id` from the token
  using the existing `resolveMember` admin path, then insert with **explicit** project scoping via
  the admin client. Never rely on `auth.uid()` for agent writes.
- RLS policies (keyed on `auth.uid()`) protect the **web/browser** read+write surface.
- A test asserts: a token for project A cannot write/read memory in project B.

## Realtime

Pinning or confirming a memory broadcasts on the existing project realtime channel so other members'
live banners update without refresh — reuses Phase 6 plumbing.

## Tool-agnostic ingest contract

Formalize `/api/ingest` payload as a versioned public contract:
```
POST /api/ingest  (Authorization: Bearer <member-token>)
{ v: 1, repo: string, branch: string|null,
  files: string[] /* repo-relative */,
  event?: { message: string },
  memory?: { text: string, file_paths?: string[], tags?: string[] } }
```
Adapters (each thin, post the same contract):
- `claude-code` — existing hook (today).
- `cursor`, `copilot`, `codex` — follow-on adapters; each computes repo-relative paths locally.
Downstream code never branches on tool — `source_tool` is provenance only.

## Eval harness (proof we lead)

A seeded persona/question set (mirroring Augur's memory eval) scores recall: for N seeded memories
and M questions, what fraction surface the right memory in top-3. Runs in CI; the bar is ≥ 90%.
Without this, "leading in memory" is an unverified claim.

## Error handling

- Memory is **additive**: any read/write failure must never block a coordination alert or ingest.
- `remember` empty text → reject. Secret detected → reject with reason. Dup → return existing id.
- `recall`/auto-attach on error → return `[]` (alert still fires).
- Embedding backfill failure → row stays searchable via FTS + file-join; retried later.
- Expired/superseded/archived excluded everywhere.

## Testing

- **Pure (no DB):** `repoRelativePath`/`normalizePath` cross-OS; ranker fusion + weights; dedup hash;
  contradiction similarity; secret detection.
- **Integration (local Supabase):** token-write RLS isolation (A cannot touch B); hybrid recall
  candidate union; supersede hides old; expiry/archive exclusion; realtime broadcast.
- **Eval:** the ≥90% recall harness in CI.
- **E2E:** pin note about `auth.ts` on machine 1 → machine 2 edits `auth.ts` → note auto-attaches in
  agent response *and* browser banner; supersede it → only new note shows.

## Build order (3 milestones)

**M1 — Solid v1 memory (own the basics, bug-free):** repo-relative path util; `memory` table + RLS;
token-correct `remember`; file-join + FTS `recall`; auto-attach to alerts; secret-scan + dedup;
supersede/archive/expire; web pin form + history; realtime; E2E. *Ship this and the wedge is sticky.*

**M2 — Lead on quality (semantic + anti-rot + proof):** pgvector embeddings (async backfill);
hybrid fused ranker; contradiction detection; recency/confidence ranking; auto-extract proposer
(confirm-to-keep); eval harness ≥90% in CI. *Ship this and we out-feature generic memory.*

**M3 — Become infrastructure (multi-tool):** formalize ingest contract v1; Cursor adapter; Copilot
adapter; Codex adapter; provenance plumbing. *Ship this and we're the neutral layer, not a plugin.*

## Upgrade path

If recall ever needs more than pgvector (cross-repo org brain, reranking models), the seams (embed
function, ranker, contract) isolate the swap. A vendor like Supermemory could slot behind the embed
seam *if* it ever beats owning it — but only after we've proven we can't lead alone.
