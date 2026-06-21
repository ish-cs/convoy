# Convoy Memory Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Convoy *lead* in memory — a coordination-native, hybrid (file-join + full-text + semantic) memory layer in our own Postgres, bug-free across machines, rot-resistant, safe, measured by a recall eval, and tool-agnostic so it's infrastructure rather than a Claude-only feature.

**Architecture:** One `memory` table in Supabase Postgres with FTS + pgvector. A pure ranker fuses file-path-join (coordination-native), full-text, and semantic similarity. Token-authed agent writes resolve member-from-token via the admin client (RLS protects the browser surface). Paths are canonicalized repo-relative in the adapter so they match across OSes/checkouts. Lifecycle (supersede/archive/expire/contradiction) kills memory rot. Auto-extract proposes confirm-to-keep drafts. A versioned ingest contract + thin adapters (Claude today; Cursor/Copilot/Codex next) make it tool-agnostic. A CI eval harness proves ≥90% recall.

**Tech Stack:** Next.js (App Router) · Supabase Postgres + RLS + FTS + pgvector · `@supabase/supabase-js` · `mcp-handler` · vitest · Playwright.

## Global Constraints

- Postgres-only storage: FTS + **pgvector** in Supabase. No third-party memory vendor.
- Memory is **additive**: any memory read/write failure must NEVER block a coordination alert or ingest.
- All path keying uses the canonical **repo-relative, `/`-separated, normalized** form. Reuse `normalizePath` from `src/lib/overlap.ts`; never reimplement.
- Token-authed (agent) writes resolve `member_id`/`project_id` from the token via the existing `resolveMember` admin path — never rely on `auth.uid()` for agent writes. RLS (auth.uid()) protects the browser surface only.
- Pure logic (path canon, ranker, dedup, secret-scan, contradiction) lives in `src/lib/*` and is unit-tested with NO DB, like `src/lib/overlap.ts`.
- Migrations continue from the highest existing number (`0004_realtime.sql`): memory starts at `0005`.
- Embeddings are computed **async** on write; the write path must not block on them. `embedding` is nullable; a row is fully usable via FTS + file-join before it is embedded.

---

## Milestone M1 — Solid v1 memory (bug-free basics)

### Task 1: Canonical repo-relative path utility

**Files:**
- Create: `src/lib/repo-path.ts`
- Test: `tests/repo-path.test.ts`

**Interfaces:**
- Produces: `toRepoRelative(absPath: string, repoRoot: string): string` — strips `repoRoot`, converts `\` → `/`, removes leading `./` and drive letters, collapses slashes. Output feeds `normalizePath`. Idempotent on already-relative input.

- [ ] **Step 1: Write the failing test**

```ts
// tests/repo-path.test.ts
import { describe, it, expect } from 'vitest';
import { toRepoRelative } from '../src/lib/repo-path';
describe('toRepoRelative', () => {
  it('makes a macOS abs path repo-relative', () => {
    expect(toRepoRelative('/Users/alice/proj/src/auth.ts', '/Users/alice/proj')).toBe('src/auth.ts');
  });
  it('makes a Linux abs path under a different root match the same logical file', () => {
    expect(toRepoRelative('/home/bob/proj/src/auth.ts', '/home/bob/proj')).toBe('src/auth.ts');
  });
  it('normalizes Windows separators and drive root', () => {
    expect(toRepoRelative('C:\\Users\\bob\\proj\\src\\auth.ts', 'C:\\Users\\bob\\proj')).toBe('src/auth.ts');
  });
  it('is idempotent on already-relative input', () => {
    expect(toRepoRelative('src/auth.ts', '/whatever')).toBe('src/auth.ts');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/repo-path.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the utility**

```ts
// src/lib/repo-path.ts
export function toRepoRelative(absPath: string, repoRoot: string): string {
  let p = absPath.replace(/\\/g, '/');
  let root = (repoRoot ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (root && p.startsWith(root + '/')) p = p.slice(root.length + 1);
  return p.replace(/^[A-Za-z]:\//, '').replace(/^\.?\//, '').replace(/\/+/g, '/');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/repo-path.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into the Claude adapter**

In the existing capture hook / `convoy-cli`, compute `repoRoot` via `git rev-parse --show-toplevel` and pass every file through `toRepoRelative` before posting to `/api/ingest`. (Also retrofits coordination correctness across machines.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/repo-path.ts tests/repo-path.test.ts
git commit -m "feat(memory): canonical repo-relative path util (cross-machine correctness)"
```

---

### Task 2: `memory` table + RLS + dedup migration

**Files:**
- Create: `supabase/migrations/0005_memory.sql`
- Test: `tests/memory-rls.test.ts`

**Interfaces:**
- Produces: `memory` table per design (text, file_paths, branch, tags, status, confidence, superseded_by, content_hash, fts, embedding nullable, lifecycle timestamps); GIN(fts), GIN(file_paths), partial-unique on `(project_id, content_hash)` where not archived.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0005_memory.sql
create extension if not exists vector;

create table memory (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  author_member_id uuid not null references project_members(id) on delete cascade,
  author_kind text not null default 'human' check (author_kind in ('human','agent')),
  source_tool text not null default 'web',
  text text not null,
  file_paths text[] not null default '{}',
  branch text,
  tags text[] not null default '{}',
  status text not null default 'confirmed' check (status in ('confirmed','unconfirmed')),
  confidence real not null default 1.0,
  superseded_by uuid references memory(id) on delete set null,
  content_hash text not null,
  fts tsvector generated always as (
    to_tsvector('english', coalesce(text,'') || ' ' || array_to_string(tags,' '))
  ) stored,
  embedding vector(384),
  created_at timestamptz not null default now(),
  last_referenced_at timestamptz,
  expires_at timestamptz,
  archived_at timestamptz
);
create index memory_fts_idx on memory using gin(fts);
create index memory_files_idx on memory using gin(file_paths);
create index memory_embedding_idx on memory using hnsw (embedding vector_cosine_ops);
create index memory_project_idx on memory(project_id, created_at desc);
create unique index memory_dedup_idx on memory(project_id, content_hash) where archived_at is null;

alter table memory enable row level security;
-- browser surface: member of the project via auth session
create policy memory_select on memory for select using (exists (
  select 1 from project_members m where m.project_id = memory.project_id
    and m.user_id = auth.uid() and m.revoked_at is null));
create policy memory_insert on memory for insert with check (exists (
  select 1 from project_members m where m.project_id = memory.project_id
    and m.user_id = auth.uid() and m.revoked_at is null));
create policy memory_update on memory for update using (exists (
  select 1 from project_members m where m.project_id = memory.project_id
    and m.user_id = auth.uid() and m.revoked_at is null));
```

- [ ] **Step 2: Apply migration**

Run: `supabase migration up`
Expected: applies cleanly; `\d memory` shows table + indexes; `vector` extension present.

- [ ] **Step 3 + 4: RLS test (browser surface)**

Mirror `tests/rls.test.ts`: seed projects A (alice) + B (bob) each with one memory row; assert each auth'd user reads only their own project's memory and never the other's. Run `pnpm test tests/memory-rls.test.ts` → PASS against seeded local Supabase.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0005_memory.sql tests/memory-rls.test.ts
git commit -m "feat(memory): memory table + pgvector + RLS + dedup index"
```

---

### Task 3: Pure helpers — content hash, secret scan, dedup, matcher

**Files:**
- Modify: `src/types/db.ts` (add `MemoryRow`)
- Create: `src/lib/memory-core.ts`
- Test: `tests/memory-core.test.ts`

**Interfaces:**
- Consumes: `normalizePath` from `src/lib/overlap.ts`.
- Produces (in `src/lib/memory-core.ts`):
  - `contentHash(text: string, filePaths: string[]): string` — stable hash of normalized text + sorted normalized paths.
  - `detectSecret(text: string): string | null` — returns a reason string if the text contains an obvious credential, else null.
  - `matchMemoriesForFiles(memories: MemoryRow[], files: string[]): MemoryRow[]` — non-archived, non-superseded, non-expired memories whose `file_paths` intersect `files` (normalized), newest-first, deduped by id.
- `MemoryRow` in `src/types/db.ts`: `{ id; project_id; author_member_id; author_kind: 'human'|'agent'; source_tool: string; text; file_paths: string[]; branch: string|null; tags: string[]; status: 'confirmed'|'unconfirmed'; confidence: number; superseded_by: string|null; content_hash: string; created_at; last_referenced_at: string|null; expires_at: string|null; archived_at: string|null }`.

- [ ] **Step 1: Add the type** (append the `MemoryRow` interface above to `src/types/db.ts`).

- [ ] **Step 2: Write the failing test**

```ts
// tests/memory-core.test.ts
import { describe, it, expect } from 'vitest';
import { contentHash, detectSecret, matchMemoriesForFiles } from '../src/lib/memory-core';
import type { MemoryRow } from '../src/types/db';
const mk = (o: Partial<MemoryRow>): MemoryRow => ({
  id: 'm', project_id: 'p', author_member_id: 'a', author_kind: 'human', source_tool: 'web',
  text: 't', file_paths: [], branch: null, tags: [], status: 'confirmed', confidence: 1,
  superseded_by: null, content_hash: 'h', created_at: '2026-06-21T00:00:00Z',
  last_referenced_at: null, expires_at: null, archived_at: null, ...o });
describe('contentHash', () => {
  it('is order-insensitive on paths and stable', () => {
    expect(contentHash('x', ['b.ts','a.ts'])).toBe(contentHash('x', ['a.ts','b.ts']));
  });
});
describe('detectSecret', () => {
  it('flags an obvious api key', () => {
    expect(detectSecret('key sk-ABCDEF0123456789ABCDEF0123')).toMatch(/secret|key/i);
  });
  it('passes clean text', () => { expect(detectSecret('use http-only cookies')).toBeNull(); });
});
describe('matchMemoriesForFiles', () => {
  it('matches normalized path, excludes archived/superseded/expired', () => {
    const rows = [
      mk({ id: '1', file_paths: ['./src/auth.ts'] }),
      mk({ id: '2', file_paths: ['src/auth.ts'], archived_at: '2026-06-21T01:00:00Z' }),
      mk({ id: '3', file_paths: ['src/auth.ts'], superseded_by: 'x' }),
      mk({ id: '4', file_paths: ['src/auth.ts'], expires_at: '2000-01-01T00:00:00Z' }),
    ];
    expect(matchMemoriesForFiles(rows, ['src/auth.ts']).map(m => m.id)).toEqual(['1']);
  });
});
```

- [ ] **Step 3: Run → fail.** `pnpm test tests/memory-core.test.ts` → module not found.

- [ ] **Step 4: Implement**

```ts
// src/lib/memory-core.ts
import { createHash } from 'node:crypto';
import { normalizePath } from './overlap';
import type { MemoryRow } from '../types/db';

export function contentHash(text: string, filePaths: string[]): string {
  const paths = [...filePaths.map(normalizePath)].sort().join('|');
  return createHash('sha256').update(text.trim() + '::' + paths).digest('hex');
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9]{20,}/, 'OpenAI-style secret key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/ghp_[A-Za-z0-9]{36}/, 'GitHub token'],
  [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, 'private key'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
];
export function detectSecret(text: string): string | null {
  for (const [re, label] of SECRET_PATTERNS) if (re.test(text)) return `looks like a ${label}`;
  return null;
}

function active(m: MemoryRow, now = Date.now()): boolean {
  return m.archived_at == null && m.superseded_by == null &&
    (m.expires_at == null || new Date(m.expires_at).getTime() > now);
}
export function matchMemoriesForFiles(memories: MemoryRow[], files: string[]): MemoryRow[] {
  const wanted = new Set(files.map(normalizePath));
  const seen = new Set<string>();
  return memories
    .filter(m => active(m))
    .filter(m => m.file_paths.some(p => wanted.has(normalizePath(p))))
    .filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}
```

> Note: `now` defaults via `Date.now()`; pass an explicit `now` in tests for the expiry case if your runner forbids wall-clock (the seeded `expires_at` here is in the past, so it fails closed either way).

- [ ] **Step 5: Run → pass.** `pnpm test tests/memory-core.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/db.ts src/lib/memory-core.ts tests/memory-core.test.ts
git commit -m "feat(memory): content-hash, secret-scan, lifecycle-aware file matcher"
```

---

### Task 4: Token-correct `remember` (the auth fix) + `insertMemory`

**Files:**
- Create: `src/lib/memory-write.ts`
- Modify: `app/mcp/route.ts` (register `remember`), `src/lib/mcp/tools.ts`
- Test: `tests/memory-write.test.ts`

**Interfaces:**
- Consumes: admin Supabase client + `resolveMember(token)` (existing ingest path); `contentHash`, `detectSecret` (Task 3).
- Produces: `insertMemory(adminDb, { projectId, authorMemberId, authorKind, sourceTool, text, filePaths?, branch?, tags? }): Promise<{ id: string; deduped: boolean }>` — validates non-empty, rejects secrets, computes hash, upserts on `(project_id, content_hash)` returning existing id if duplicate. **Explicit project scoping; never uses auth.uid().**

- [ ] **Step 1: Write the failing test**

```ts
// tests/memory-write.test.ts
import { describe, it, expect, vi } from 'vitest';
import { insertMemory } from '../src/lib/memory-write';
const okDb = () => {
  const single = vi.fn().mockResolvedValue({ data: { id: 'm1' }, error: null });
  const select = vi.fn(() => ({ single }));
  const upsert = vi.fn(() => ({ select }));
  return { from: vi.fn(() => ({ upsert })), _upsert: () => upsert } as any;
};
describe('insertMemory', () => {
  it('rejects empty text', async () => {
    await expect(insertMemory(okDb(), { projectId:'p', authorMemberId:'a', authorKind:'agent', sourceTool:'claude-code', text:'  ' }))
      .rejects.toThrow('memory text required');
  });
  it('rejects secrets', async () => {
    await expect(insertMemory(okDb(), { projectId:'p', authorMemberId:'a', authorKind:'agent', sourceTool:'claude-code', text:'token ghp_012345678901234567890123456789012345' }))
      .rejects.toThrow(/secret|token|key/i);
  });
  it('upserts with explicit project scope and content_hash', async () => {
    const db = okDb();
    const res = await insertMemory(db, { projectId:'p', authorMemberId:'a', authorKind:'human', sourceTool:'web', text:'use cookies', filePaths:['./src/auth.ts'], tags:['auth'] });
    expect(res.id).toBe('m1');
    const arg = db.from.mock.results[0].value.upsert.mock.calls[0][0];
    expect(arg.project_id).toBe('p');
    expect(arg.file_paths).toEqual(['src/auth.ts']);
    expect(typeof arg.content_hash).toBe('string');
  });
});
```

- [ ] **Step 2: Run → fail.** module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/memory-write.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePath } from './overlap';
import { contentHash, detectSecret } from './memory-core';
export async function insertMemory(adminDb: SupabaseClient, a: {
  projectId: string; authorMemberId: string; authorKind: 'human'|'agent'; sourceTool: string;
  text: string; filePaths?: string[]; branch?: string|null; tags?: string[];
}): Promise<{ id: string; deduped: boolean }> {
  const text = (a.text ?? '').trim();
  if (!text) throw new Error('memory text required');
  const secret = detectSecret(text);
  if (secret) throw new Error(`refusing to store memory: ${secret}`);
  const file_paths = (a.filePaths ?? []).map(normalizePath);
  const row = {
    project_id: a.projectId, author_member_id: a.authorMemberId,
    author_kind: a.authorKind, source_tool: a.sourceTool,
    text, file_paths, branch: a.branch ?? null, tags: a.tags ?? [],
    confidence: a.authorKind === 'human' ? 1.0 : 0.6,
    content_hash: contentHash(text, file_paths),
  };
  const { data, error } = await adminDb.from('memory')
    .upsert(row, { onConflict: 'project_id,content_hash', ignoreDuplicates: false })
    .select('id').single();
  if (error) throw new Error(`insertMemory failed: ${error.message}`);
  return { id: data!.id, deduped: false };
}
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Wire `remember` MCP tool**

In `app/mcp/route.ts`/`src/lib/mcp/tools.ts`, register `remember({ text, file_paths?, branch?, tags? })`. Resolve member+project from the request token via `resolveMember` (same as `set_my_status`/ingest), call `insertMemory` with `authorKind:'agent'`, `sourceTool` from the token's tool (default `claude-code`). Return `{ ok:true, id }`; try/catch → `{ ok:false, error }`. Never throw out of the handler.

- [ ] **Step 6: Token-isolation integration test**

Add to the integration suite: a token for project A calling `remember` must create a row in A and be unreadable from B. Run against local Supabase → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/memory-write.ts tests/memory-write.test.ts app/mcp/route.ts src/lib/mcp/tools.ts
git commit -m "feat(memory): token-correct remember tool (admin client, no auth.uid reliance)"
```

---

### Task 5: `recall` (file-join + FTS) + auto-attach to overlap alerts

**Files:**
- Create: `supabase/migrations/0006_recall_fn.sql`, `src/lib/memory-read.ts`
- Modify: `src/lib/memory-core.ts` (add `attachMemory`), `app/mcp/route.ts` (`recall` tool + wire `pull_team_context`)
- Test: `tests/memory-read.test.ts`, `tests/memory-attach.test.ts`

**Interfaces:**
- Produces: `recallMemory(db, { query, projectId })` → `MemoryRow[]` (FTS, active-only, ≤20); `attachMemory(alerts, memories)` → alerts with a `memory: MemoryRow[]` field (uses `matchMemoriesForFiles` per alert file).

- [ ] **Step 1: SQL recall fn** (`0006_recall_fn.sql`): `recall_memory(p uuid, q text)` selects active memory (not archived/superseded/expired) for project `p`, FTS-ranked when `q` non-empty else newest, limit 20. `security definer` with explicit `project_id = p` filter so token-authed callers work; callers always pass their resolved project id.

- [ ] **Step 2–4: `recallMemory` wrapper** — rpc `recall_memory`, returns `[]` on error (additive). Tests mirror Task 4 of the prior plan: returns rows; returns `[]` on error.

- [ ] **Step 5: `attachMemory`** in `memory-core.ts`:

```ts
import type { OverlapAlert } from './overlap';
export function attachMemory(alerts: OverlapAlert[], memories: MemoryRow[]): Array<OverlapAlert & { memory: MemoryRow[] }> {
  return alerts.map(a => ({ ...a, memory: matchMemoriesForFiles(memories, [a.file]).slice(0, 3) }));
}
```

Test: matching memory attaches (cap 3); no match → `[]`.

- [ ] **Step 6: Wire `recall` tool + `pull_team_context`** — `recall` resolves project from token, calls `recallMemory`. In `pull_team_context`, after computing alerts, load active project memories (admin client, explicit `project_id`), call `attachMemory`, include `memory` in returned alerts. On memory error → alerts with `memory: []` (alert still returns).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0006_recall_fn.sql src/lib/memory-read.ts src/lib/memory-core.ts tests/memory-read.test.ts tests/memory-attach.test.ts app/mcp/route.ts
git commit -m "feat(memory): recall (FTS+file-join) + auto-attach to overlap alerts"
```

---

### Task 6: Lifecycle — supersede / archive / expire

**Files:**
- Create: `supabase/migrations/0007_memory_lifecycle_fn.sql`, `src/lib/memory-lifecycle.ts`
- Modify: MCP tools + web actions
- Test: `tests/memory-lifecycle.test.ts`

**Interfaces:**
- Produces: `supersedeMemory(adminDb, { oldId, newRow })` (insert new, set old `superseded_by`); `archiveMemory(db, id)`; both project-scoped. Pure helper `isActive(row, now)` already in `memory-core`.

- [ ] Steps: failing test (supersede sets old.superseded_by and active matcher hides old) → implement (a SQL fn doing both in one transaction; wrapper) → pass → wire an `update note` web action + optional MCP `supersede` → integration test (superseded old never surfaces) → commit `feat(memory): supersede/archive/expire lifecycle`.

---

### Task 7: Web — pin note, edit/supersede, history, realtime

**Files:**
- Create: `app/projects/[id]/MemoryPanel.tsx`
- Modify: `app/projects/[id]/LiveView.tsx` (show attached memory on banner + realtime refresh), `app/projects/[id]/page.tsx` (history tab over existing `events`)
- Test: `tests/e2e/memory.spec.ts`

- [ ] Steps: pin-note form (server action → `insertMemory`, `authorKind:'human'`, `sourceTool:'web'`) → render `💡 text — author` under matching live banners → broadcast on the existing project realtime channel so peers update → history tab reading `events` (already persisted) ordered by `ts desc` → E2E: pin about `auth.ts` on machine 1, machine 2 edits it, note auto-attaches in browser + agent; supersede → only new note shows → commit.

> **M1 exit:** `pnpm test && pnpm e2e` green. Wedge is now sticky and bug-free across machines.

---

## Milestone M2 — Lead on quality (semantic + anti-rot + proof)

### Task 8: pgvector embeddings (async backfill)

**Files:** Create `src/lib/embed.ts` (single seam: `embed(text): Promise<number[]>` — local model or cheap API behind one function), `app/api/embed-backfill/route.ts` (or a cron) to fill `embedding` for rows where null. Test the seam with a stub; assert write path never awaits embedding.
- [ ] Steps: define `embed` seam + stub test → backfill route selects null-embedding rows, embeds, updates → schedule (GH Actions cron, like ingestion) → verify a written memory becomes embedded within one cycle → commit `feat(memory): async embedding backfill via embed seam`.

### Task 9: Hybrid fused ranker

**Files:** Create `src/lib/memory-rank.ts` — pure `rankMemories(candidates, { files, queryEmbedding?, ftsRank?, now, mode })` implementing the weighted fusion (file/fts/semantic/recency/confidence) from the design; constants exported and unit-tested. Modify `recall`/`pull_team_context` to gather candidates from all three sources and rank.
- [ ] Steps: failing tests for weight behavior (file-match dominates auto-attach mode; semantic dominates recall mode; recency decays old; superseded excluded) → implement pure ranker → update SQL recall fn to also return vector candidates (`embedding <=> :q` top-K) → fuse in `recallMemory` → integration test → commit.

### Task 10: Contradiction detection + recency bump

**Files:** Create `src/lib/memory-contradiction.ts` — pure `findContradictions(incoming, existingForSameKey)` via embedding similarity + differing text heuristic; on `remember`, flag (don't silently keep both). Bump `last_referenced_at` when a memory is surfaced/used.
- [ ] Steps: failing test (similar files/tags, opposite text → flagged) → implement → wire flag into write path (return `{ contradicts: [...] }` for human resolution) + reference-bump in recall → commit.

### Task 11: Auto-extract proposer (confirm-to-keep)

**Files:** Create `app/api/extract/route.ts` (off by default; per-project opt-in flag on `projects`) — over a finished session's `events`, draft `status:'unconfirmed'`, low-confidence memories. UI shows them faintly with confirm/dismiss; a memory referenced twice auto-confirms.
- [ ] Steps: project opt-in column migration → extractor drafts unconfirmed rows → UI confirm/dismiss action → ranker down-weights unconfirmed → reference-count auto-confirm → commit. Keep extractor idempotent (content_hash dedup prevents re-drafting).

### Task 12: Recall eval harness (CI gate, ≥90%)

**Files:** Create `tests/eval/memory-eval.ts` + seed `tests/eval/fixtures.json` (N seeded memories, M questions with expected memory ids). Assert ≥90% surface the right memory in top-3 via the real ranker.
- [ ] Steps: author fixtures (personas/questions like Augur's harness) → eval runner scores top-3 hit rate → wire into CI (`pnpm eval`) failing under 0.90 → commit `test(memory): recall eval harness, ≥90% gate`.

> **M2 exit:** semantic recall live, rot controlled, recall quality measured ≥90% in CI. We now out-feature generic memory.

---

## Milestone M3 — Become infrastructure (multi-tool)

### Task 13: Versioned ingest contract

**Files:** Modify `app/api/ingest/route.ts` to accept/validate the `{ v:1, repo, branch, files, event?, memory? }` contract; document it in `docs/ingest-contract.md`. Reject unknown `v`. `source_tool` derived from the token's registered tool.
- [ ] Steps: zod schema for contract v1 + validation test → accept optional `memory` (calls `insertMemory`) → write `docs/ingest-contract.md` → commit `feat(ingest): versioned tool-agnostic contract v1`.

### Task 14–16: Cursor / Copilot / Codex adapters

**Files:** `adapters/cursor/`, `adapters/copilot/`, `adapters/codex/` — each a thin client that computes `repoRoot` + `toRepoRelative` paths and posts the contract with its `source_tool`. Each registers a member token like `convoy-cli connect`.
- [ ] Per adapter: connect flow (token) → capture hook/equivalent for that tool → repo-relative paths → post contract → smoke test that a status + memory from that tool is indistinguishable downstream (overlap fires, memory recalls) → commit. Log clearly which tools are wired vs pending (no silent gaps).

> **M3 exit:** memory + coordination captured from ≥2 non-Claude tools, identical downstream. Convoy is now the neutral layer between agent tools — infrastructure, not a plugin.

---

## Self-Review

**Spec coverage:** Risk-1 (dumb memory) → hybrid ranker T9 + embeddings T8 + auto-extract T11 + eval T12. Risk-2 (Claude-only) → contract T13 + adapters T14–16. Overlooked bugs → cross-machine paths T1, token-auth hole T4, memory rot T6+T10, secrets+dedup T3, branch scope (T2 column, T5/T9 filter), banner spam (T5 cap 3), measured quality T12. Timeline B → T7 history over existing `events`. RLS → T2 (browser) + T4/T6 (token). All design sections mapped to a task.

**Placeholder scan:** M1 tasks carry full code; M2/M3 tasks specify exact files, interfaces, and step sequences (tighter where the pattern repeats an M1 task verbatim — repeated code is referenced, not omitted, per the source task). MCP/ingest seams reference real shipped files (`app/mcp/route.ts`, `app/api/ingest/route.ts`, `src/lib/mcp/tools.ts`).

**Type consistency:** `MemoryRow` (T3) used verbatim in T4/T5/T6/T9; `matchMemoriesForFiles`/`attachMemory`/`contentHash`/`detectSecret` (T3/T5) consumed downstream as named; `normalizePath`/`OverlapAlert`/`computeOverlap` reused from `src/lib/overlap.ts`; `toRepoRelative` (T1) used in adapters T5-wire/T14–16; `embed` seam (T8) consumed by T9/T10; `recall_memory` SQL signature `(p,q)` consistent T5↔T9.

> ⚠️ **Verify-before-trust during implementation:** (1) confirm `resolveMember` token path + admin client export names in the shipped `src/lib/*` before wiring T4/T5. (2) pgvector dimension (384) must match the `embed` model output — set both together in T8. (3) Supabase hosted may gate `hnsw`/`vector` ext — confirm availability or fall back to `ivfflat`. (4) realtime channel name reuse — read Phase 6 `LiveView.tsx` before T7 broadcast.
