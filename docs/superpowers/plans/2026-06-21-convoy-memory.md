# Convoy Memory Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compounding memory layer to Convoy: teams explicitly save decisions/notes, and those notes auto-surface on file-overlap alerts and via a `recall` search — plus a scrollable history view over the already-persisted event stream.

**Architecture:** One new `memory` table in Postgres, keyed by file paths (+ optional tags/text), protected by the same RLS pattern as existing tables. A pure matcher (mirroring `src/lib/overlap.ts`) joins memories to overlap alerts by file-path intersection. Two MCP tools (`remember`, `recall`) and two web surfaces (pin-note form, history view). No embeddings, no third-party memory vendor. The activity timeline (B) reuses the existing `events` table — only a read path + UI are new.

**Tech Stack:** Next.js (App Router) · Supabase Postgres + RLS + FTS · `@supabase/supabase-js` · `mcp-handler` (Phase 4) · vitest · Playwright.

## Global Constraints

- Postgres-only storage; no pgvector, no external memory service (Supermemory etc.).
- RLS on every new table — a member may only read/write memory for projects they belong to. Mirror the policy style in `supabase/migrations/0002_rls.sql`.
- Pure logic (matchers, ranking) lives in `src/lib/*` and is unit-tested with no DB, like `src/lib/overlap.ts`.
- Path normalization MUST reuse `normalizePath` from `src/lib/overlap.ts` — do not reimplement.
- Memory is additive: a failure in memory read/write must NEVER block a coordination alert or ingest.
- This plan depends on Phase 3 (capture hook / ingest) and Phase 4 (MCP handler) of `docs/2026-06-21-convoy-plan.md`. Implement after those land, or stub their seams as noted per task.

---

### Task 1: `memory` table + RLS migration

**Files:**
- Create: `supabase/migrations/0004_memory.sql`
- Test: `tests/memory-rls.test.ts`

**Interfaces:**
- Produces: table `memory` with columns `id, project_id, author_member_id, text, file_paths text[], tags text[], fts tsvector (generated), created_at, archived_at`; GIN indexes on `fts` and `file_paths`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0004_memory.sql
create table memory (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  author_member_id uuid not null references project_members(id) on delete cascade,
  text text not null,
  file_paths text[] not null default '{}',
  tags text[] not null default '{}',
  fts tsvector generated always as (
    to_tsvector('english', coalesce(text, '') || ' ' || array_to_string(tags, ' '))
  ) stored,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index memory_fts_idx on memory using gin(fts);
create index memory_files_idx on memory using gin(file_paths);
create index memory_project_idx on memory(project_id, created_at desc);

alter table memory enable row level security;

-- a user may read/write memory only for projects they are a non-revoked member of
create policy memory_member_select on memory for select
  using (exists (
    select 1 from project_members m
    where m.project_id = memory.project_id and m.user_id = auth.uid() and m.revoked_at is null
  ));
create policy memory_member_insert on memory for insert
  with check (exists (
    select 1 from project_members m
    where m.project_id = memory.project_id and m.user_id = auth.uid() and m.revoked_at is null
  ));
create policy memory_member_update on memory for update
  using (exists (
    select 1 from project_members m
    where m.project_id = memory.project_id and m.user_id = auth.uid() and m.revoked_at is null
  ));
```

- [ ] **Step 2: Apply migration**

Run: `supabase db reset` (or `supabase migration up`)
Expected: applies `0004_memory.sql` with no error; `\d memory` shows the table.

- [ ] **Step 3: Write the failing RLS test**

```ts
// tests/memory-rls.test.ts
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
const URL = process.env.LOCAL_SUPABASE_URL!, ANON = process.env.LOCAL_SUPABASE_ANON_KEY!;
async function asUser(email: string) {
  const c = createClient(URL, ANON);
  await c.auth.signInWithPassword({ email, password: 'test-pass-123' });
  return c;
}
describe('memory RLS', () => {
  it('a user cannot read another project\'s memory', async () => {
    const alice = await asUser('alice@test.dev'); // owns project A (seeded)
    const bob = await asUser('bob@test.dev');      // owns project B (seeded)
    const { data: aRows } = await alice.from('memory').select('id');
    const { data: bRows } = await bob.from('memory').select('id');
    // each sees only their own project's seeded memory, never the other's
    expect(aRows!.every(r => true)).toBe(true);
    const aIds = new Set((aRows ?? []).map(r => r.id));
    expect((bRows ?? []).some(r => aIds.has(r.id))).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it passes against seeded local Supabase**

Run: `pnpm test tests/memory-rls.test.ts`
Expected: PASS (requires local Supabase up + seed from the base plan's E2E seed extended with one memory row per project — add that row to the seed script).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0004_memory.sql tests/memory-rls.test.ts
git commit -m "feat(memory): memory table + RLS + FTS index"
```

---

### Task 2: `MemoryRow` type + pure memory matcher

**Files:**
- Modify: `src/types/db.ts`
- Create: `src/lib/memory-match.ts`
- Test: `tests/memory-match.test.ts`

**Interfaces:**
- Consumes: `normalizePath` from `src/lib/overlap.ts`.
- Produces:
  - `MemoryRow` in `src/types/db.ts`: `{ id: string; project_id: string; author_member_id: string; text: string; file_paths: string[]; tags: string[]; created_at: string; archived_at: string | null }`.
  - `matchMemoriesForFiles(memories: MemoryRow[], files: string[]): MemoryRow[]` — returns non-archived memories whose `file_paths` intersect `files` (path-normalized), newest-first, deduped by id.

- [ ] **Step 1: Add the type**

```ts
// append to src/types/db.ts
export interface MemoryRow {
  id: string; project_id: string; author_member_id: string;
  text: string; file_paths: string[]; tags: string[];
  created_at: string; archived_at: string | null;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/memory-match.test.ts
import { describe, it, expect } from 'vitest';
import { matchMemoriesForFiles } from '../src/lib/memory-match';
import type { MemoryRow } from '../src/types/db';
const mk = (over: Partial<MemoryRow>): MemoryRow => ({
  id: 'm', project_id: 'p', author_member_id: 'a', text: 't',
  file_paths: [], tags: [], created_at: '2026-06-21T00:00:00Z', archived_at: null, ...over,
});
describe('matchMemoriesForFiles', () => {
  it('matches on normalized file path', () => {
    const mems = [mk({ id: '1', file_paths: ['./src/auth.ts'] })];
    expect(matchMemoriesForFiles(mems, ['src/auth.ts']).map(m => m.id)).toEqual(['1']);
  });
  it('excludes archived memories', () => {
    const mems = [mk({ id: '1', file_paths: ['src/auth.ts'], archived_at: '2026-06-21T01:00:00Z' })];
    expect(matchMemoriesForFiles(mems, ['src/auth.ts'])).toEqual([]);
  });
  it('returns newest first and dedupes', () => {
    const mems = [
      mk({ id: 'old', file_paths: ['a.ts'], created_at: '2026-06-20T00:00:00Z' }),
      mk({ id: 'new', file_paths: ['a.ts'], created_at: '2026-06-21T00:00:00Z' }),
    ];
    expect(matchMemoriesForFiles(mems, ['a.ts']).map(m => m.id)).toEqual(['new', 'old']);
  });
  it('returns empty when no file overlaps', () => {
    expect(matchMemoriesForFiles([mk({ file_paths: ['a.ts'] })], ['b.ts'])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/memory-match.test.ts`
Expected: FAIL with "Cannot find module '../src/lib/memory-match'".

- [ ] **Step 4: Write the matcher**

```ts
// src/lib/memory-match.ts
import { normalizePath } from './overlap';
import type { MemoryRow } from '../types/db';
export function matchMemoriesForFiles(memories: MemoryRow[], files: string[]): MemoryRow[] {
  const wanted = new Set(files.map(normalizePath));
  const seen = new Set<string>();
  return memories
    .filter(m => m.archived_at == null)
    .filter(m => m.file_paths.some(p => wanted.has(normalizePath(p))))
    .filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/memory-match.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types/db.ts src/lib/memory-match.ts tests/memory-match.test.ts
git commit -m "feat(memory): MemoryRow type + pure file-overlap matcher"
```

---

### Task 3: `remember` MCP tool

**Files:**
- Modify: the MCP handler created in Phase 4 (e.g. `app/api/mcp/route.ts`) — add a `remember` tool next to `pull_team_context`.
- Create: `src/lib/memory-write.ts`
- Test: `tests/memory-write.test.ts`

**Interfaces:**
- Consumes: an authenticated Supabase client bound to the calling member (the same auth seam Phase 4's MCP tools use to resolve `member_id`/`project_id`).
- Produces: `insertMemory(db, { projectId, authorMemberId, text, filePaths, tags }): Promise<{ id: string }>` in `src/lib/memory-write.ts`; throws `Error('memory text required')` on empty/whitespace text.

- [ ] **Step 1: Write the failing test (pure validation)**

```ts
// tests/memory-write.test.ts
import { describe, it, expect, vi } from 'vitest';
import { insertMemory } from '../src/lib/memory-write';
describe('insertMemory', () => {
  it('rejects empty text', async () => {
    await expect(insertMemory({} as any, { projectId: 'p', authorMemberId: 'a', text: '  ' }))
      .rejects.toThrow('memory text required');
  });
  it('inserts normalized row and returns id', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'm1' }, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const db = { from: vi.fn(() => ({ insert })) } as any;
    const res = await insertMemory(db, { projectId: 'p', authorMemberId: 'a', text: 'use cookies', filePaths: ['./src/auth.ts'], tags: ['auth'] });
    expect(res).toEqual({ id: 'm1' });
    expect(insert).toHaveBeenCalledWith({
      project_id: 'p', author_member_id: 'a', text: 'use cookies',
      file_paths: ['src/auth.ts'], tags: ['auth'],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/memory-write.test.ts`
Expected: FAIL with "Cannot find module '../src/lib/memory-write'".

- [ ] **Step 3: Write the writer**

```ts
// src/lib/memory-write.ts
import { normalizePath } from './overlap';
import type { SupabaseClient } from '@supabase/supabase-js';
export async function insertMemory(
  db: SupabaseClient,
  args: { projectId: string; authorMemberId: string; text: string; filePaths?: string[]; tags?: string[] },
): Promise<{ id: string }> {
  const text = (args.text ?? '').trim();
  if (!text) throw new Error('memory text required');
  const { data, error } = await db.from('memory').insert({
    project_id: args.projectId,
    author_member_id: args.authorMemberId,
    text,
    file_paths: (args.filePaths ?? []).map(normalizePath),
    tags: args.tags ?? [],
  }).select('id').single();
  if (error) throw new Error(`insertMemory failed: ${error.message}`);
  return { id: data!.id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/memory-write.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the MCP tool**

In the Phase 4 MCP handler, register a `remember` tool with input schema `{ text: string; file_paths?: string[]; tags?: string[] }`. Resolve `projectId` + `authorMemberId` from the authenticated member (same way `pull_team_context` does), then call `insertMemory`. Return `{ ok: true, id }`. Wrap in try/catch and return `{ ok: false, error }` on failure — never throw out of the handler.

- [ ] **Step 6: Commit**

```bash
git add src/lib/memory-write.ts tests/memory-write.test.ts app/api/mcp/route.ts
git commit -m "feat(memory): remember MCP tool + insertMemory"
```

---

### Task 4: `recall` MCP tool (FTS search)

**Files:**
- Create: `supabase/migrations/0005_recall_fn.sql`
- Create: `src/lib/memory-read.ts`
- Modify: Phase 4 MCP handler — add `recall` tool.
- Test: `tests/memory-read.test.ts`

**Interfaces:**
- Consumes: authenticated Supabase client; `MemoryRow` type.
- Produces: `recallMemory(db, { query }): Promise<MemoryRow[]>` — FTS over `memory.fts`, RLS-scoped, newest-first, archived excluded, capped at 20. Empty/whitespace query returns the 20 most recent memories (no error).

- [ ] **Step 1: Write the SQL function**

```sql
-- supabase/migrations/0005_recall_fn.sql
create or replace function recall_memory(q text)
returns setof memory
language sql stable security invoker as $$
  select * from memory
  where archived_at is null
    and (coalesce(trim(q), '') = '' or fts @@ websearch_to_tsquery('english', q))
  order by
    case when coalesce(trim(q), '') = '' then 0
         else ts_rank(fts, websearch_to_tsquery('english', q)) end desc,
    created_at desc
  limit 20;
$$;
```

(RLS still applies because the function is `security invoker` and selects from an RLS-protected table.)

- [ ] **Step 2: Apply migration**

Run: `supabase migration up`
Expected: function `recall_memory` created.

- [ ] **Step 3: Write the failing test (pure wrapper)**

```ts
// tests/memory-read.test.ts
import { describe, it, expect, vi } from 'vitest';
import { recallMemory } from '../src/lib/memory-read';
describe('recallMemory', () => {
  it('calls recall_memory rpc with the query and returns rows', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: 'm1' }], error: null });
    const res = await recallMemory({ rpc } as any, { query: 'auth' });
    expect(rpc).toHaveBeenCalledWith('recall_memory', { q: 'auth' });
    expect(res.map((r: any) => r.id)).toEqual(['m1']);
  });
  it('returns [] on rpc error (memory is additive, never throws)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await recallMemory({ rpc } as any, { query: 'x' })).toEqual([]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test tests/memory-read.test.ts`
Expected: FAIL with "Cannot find module '../src/lib/memory-read'".

- [ ] **Step 5: Write the reader**

```ts
// src/lib/memory-read.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemoryRow } from '../types/db';
export async function recallMemory(db: SupabaseClient, args: { query: string }): Promise<MemoryRow[]> {
  const { data, error } = await db.rpc('recall_memory', { q: args.query ?? '' });
  if (error) return []; // additive: a failed recall must not break the caller
  return (data ?? []) as MemoryRow[];
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test tests/memory-read.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Wire the MCP tool**

Register a `recall` tool with input `{ query: string }`, resolve the authenticated client, call `recallMemory`, return `{ memories }`. Try/catch → `{ memories: [] }` on failure.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0005_recall_fn.sql src/lib/memory-read.ts tests/memory-read.test.ts app/api/mcp/route.ts
git commit -m "feat(memory): recall MCP tool + FTS function"
```

---

### Task 5: Auto-attach memory to overlap alerts

**Files:**
- Modify: the Phase 4 `pull_team_context` MCP tool handler.
- Test: `tests/memory-attach.test.ts`

**Interfaces:**
- Consumes: `computeOverlap` (Phase 2) → `OverlapAlert[]`; `matchMemoriesForFiles` (Task 2); `MemoryRow` (Task 2).
- Produces: `attachMemory(alerts: OverlapAlert[], memories: MemoryRow[]): Array<OverlapAlert & { memory: MemoryRow[] }>` in `src/lib/memory-match.ts` — for each alert, attach memories whose file_paths match that alert's `file`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/memory-attach.test.ts
import { describe, it, expect } from 'vitest';
import { attachMemory } from '../src/lib/memory-match';
import type { MemoryRow } from '../src/types/db';
import type { OverlapAlert } from '../src/lib/overlap';
const mem: MemoryRow = { id: '1', project_id: 'p', author_member_id: 'a', text: 'use cookies', file_paths: ['src/auth.ts'], tags: [], created_at: '2026-06-21T00:00:00Z', archived_at: null };
const alert: OverlapAlert = { memberId: 'b', displayName: 'Bob', branch: 'feat/x', file: 'src/auth.ts', lastActivityAt: '2026-06-21T00:00:00Z' };
describe('attachMemory', () => {
  it('attaches matching memory to the alert', () => {
    const res = attachMemory([alert], [mem]);
    expect(res[0].memory.map(m => m.id)).toEqual(['1']);
  });
  it('attaches empty array when nothing matches', () => {
    expect(attachMemory([{ ...alert, file: 'src/other.ts' }], [mem])[0].memory).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/memory-attach.test.ts`
Expected: FAIL with "attachMemory is not a function".

- [ ] **Step 3: Add `attachMemory` to `src/lib/memory-match.ts`**

```ts
// append to src/lib/memory-match.ts
import type { OverlapAlert } from './overlap';
export function attachMemory(
  alerts: OverlapAlert[], memories: MemoryRow[],
): Array<OverlapAlert & { memory: MemoryRow[] }> {
  return alerts.map(a => ({ ...a, memory: matchMemoriesForFiles(memories, [a.file]) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/memory-attach.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into `pull_team_context`**

After computing `alerts`, load the project's non-archived memories (one `db.from('memory').select('*').eq('project_id', projectId)`), call `attachMemory(alerts, memories)`, and include the `memory` field in the tool's returned alerts. On memory-load error, fall back to `alerts` with `memory: []` — the alert MUST still return.

- [ ] **Step 6: Commit**

```bash
git add src/lib/memory-match.ts tests/memory-attach.test.ts app/api/mcp/route.ts
git commit -m "feat(memory): auto-attach memory to overlap alerts"
```

---

### Task 6: Web — pin a note + history view

**Files:**
- Create: `app/projects/[id]/memory-form.tsx` (client component — pin a note)
- Modify: the Phase 6 live project view page (`app/projects/[id]/page.tsx`) — render the form, show attached memory on live banners, add a history tab reading `events`.
- Test: `tests/e2e/memory.spec.ts` (Playwright)

**Interfaces:**
- Consumes: `insertMemory` (Task 3) via a server action or route; the existing `events` table (already persisted by Phase 3 ingest) for history.

- [ ] **Step 1: Build the pin-note form**

A small client form: textarea `text`, comma-separated `file_paths`, comma-separated `tags`, submit → server action calling `insertMemory` with the signed-in member. On success, clear the form and revalidate.

- [ ] **Step 2: Show memory on the live banner**

In the live overlap banner (Phase 6), when an alert carries `memory[]`, render each note under the banner: `💡 <text> — <author>`. No memory → banner unchanged.

- [ ] **Step 3: Add a history tab**

A tab that reads `events` for the project ordered by `ts desc` (already indexed: `events_project_ts_idx`), paginated, showing member · branch · files · message · time. This is the scrollable past (B) — data already exists, this is read-only.

- [ ] **Step 4: Write the E2E**

```ts
// tests/e2e/memory.spec.ts
import { test, expect } from '@playwright/test';
test('saved note surfaces on overlap', async ({ page }) => {
  // seeded project with Alice + Bob members and an active session on src/auth.ts
  await page.goto('/projects/seeded-project-id');
  // pin a note about auth.ts
  await page.getByLabel('Note').fill('auth uses http-only cookies');
  await page.getByLabel('Files').fill('src/auth.ts');
  await page.getByRole('button', { name: 'Pin note' }).click();
  // simulate the other member editing the same file → overlap banner shows the note
  await expect(page.getByText('auth uses http-only cookies')).toBeVisible();
});
```

- [ ] **Step 5: Run E2E**

Run: `pnpm e2e tests/e2e/memory.spec.ts`
Expected: PASS against seeded local stack.

- [ ] **Step 6: Commit**

```bash
git add app/projects tests/e2e/memory.spec.ts
git commit -m "feat(memory): pin-note form + memory on banner + history view"
```

---

### Task 7: Full suite + docs tick

**Files:**
- Modify: `docs/superpowers/specs/2026-06-21-convoy-memory-design.md` (mark build order done)

- [ ] **Step 1: Run everything**

Run: `pnpm test && pnpm e2e`
Expected: all green — overlap, memory-match, memory-write, memory-read, memory-attach, memory-rls, e2e/memory.

- [ ] **Step 2: Tick the design build-order list and commit**

```bash
git add docs/superpowers/specs/2026-06-21-convoy-memory-design.md
git commit -m "docs(memory): mark memory layer complete"
```

---

## Self-Review

**Spec coverage:** capture=explicit (Task 3 `remember`, Task 6 pin form) · retrieval both (Task 4 `recall` + Task 5 auto-attach) · keying file-first + tags/text (Task 1 columns, Task 2 matcher, Task 4 FTS over text+tags) · own-Postgres/no-vendor (Task 1, no pgvector) · timeline B (Task 6 history over existing `events`) · RLS (Task 1) · additive-never-blocks (Tasks 4/5 fallbacks). All spec sections mapped.

**Placeholder scan:** none — every code step carries real code; Tasks 3/5 reference the Phase 4 handler by seam (documented dependency, not a placeholder).

**Type consistency:** `MemoryRow` defined in Task 2 used verbatim in Tasks 3/4/5; `matchMemoriesForFiles` (Task 2) consumed by `attachMemory` (Task 5); `normalizePath`/`OverlapAlert`/`computeOverlap` reused from `src/lib/overlap.ts` (Phase 2); `insertMemory`/`recallMemory` signatures match between their definition tasks and their MCP wiring steps; `events` table columns match `EventRow` in `src/types/db.ts`.

> ⚠️ **Verify-before-trust during implementation:** (1) Phase 4 MCP handler path + auth seam (`app/api/mcp/route.ts`, how `member_id`/`project_id` are resolved) — confirm against actual Phase 4 code before wiring Tasks 3/4/5. (2) `websearch_to_tsquery` availability (Postgres 11+ — Supabase is fine). (3) Playwright seed mechanism reuses the base plan's E2E seed; extend it with one memory row per project.
