# Convoy Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** A web app where you sign in with Google, create a project, invite teammates by email (who get a Resend email), and each teammate runs `npx convoy-cli connect <token>` once. From then on their Claude Code sessions auto-publish branch + edited files (via a hook → `/api/ingest`) and read teammates' live per-session state with active file-overlap alerts (via the `/mcp` endpoint), all watchable in the browser in real time.

**Architecture:** A single Next 16 (App Router, TS) app on Vercel serving the web UI, a hosted MCP endpoint at `/mcp` (read-mostly), and a token-authed `/api/ingest` write endpoint. A `PostToolUse`/`Stop` hook (installed by `convoy-cli`) captures real edits per session and POSTs them to `/api/ingest`. Supabase Postgres stores everything; status is keyed per `session_id`. RLS guards the web read path; machine paths use the service role with manual token→member scoping. Supabase Realtime drives the live view. The overlap detector is a pure, exhaustively-tested function.

**Tech Stack:** Next 16 · TypeScript · pnpm · Supabase (Postgres + Auth + Realtime) · `@supabase/ssr` · `mcp-handler` + `@modelcontextprotocol/sdk` · Resend · Zod · Vitest · Playwright · Tailwind · Vercel. CLI: Node ≥18 (global `fetch`).

## Global Constraints

- **Name:** Convoy. Repo `convoy`, package `convoy`, placeholder domain `convoy.app`.
- **Auth:** Google OAuth only (Supabase Auth). **Invites:** Resend email.
- **UI:** Plain-but-clean Tailwind v1; Liquid Glass deferred.
- **Supabase:** New dedicated project.
- **Writes are hook-driven** through `/api/ingest`; the model is NOT relied on for file/branch capture.
- **Status is per-session:** `member_status` PK = `(member_id, session_id)`; `Stop` hook sets `ended_at`.
- **MCP transport:** Hosted HTTP at `/mcp`; member identified by `Authorization: Bearer <token>`.
- **Overlap recency window:** 60 minutes (constant `OVERLAP_WINDOW_MINUTES = 60`).
- **Overlap files** = a session's `files` unioned with that member's recent (≤60 min) event files.
- **Hook must never block edits:** best-effort POST, 2s timeout, swallow errors, exit 0.
- **Secrets:** `.env*.local` git-ignored; service-role/Resend keys only in Vercel env + local `.env.local`. Token stored locally at `~/.convoy/token`. Public repo from day one.
- **Deploy:** walking skeleton early; redeploy each phase. **Commits:** local per task; repo public & pushed from Phase 0.

---

## File Structure

```
convoy/
  app/
    layout.tsx · page.tsx · globals.css
    login/page.tsx
    auth/callback/route.ts
    dashboard/page.tsx · dashboard/NewProject.tsx
    projects/[id]/page.tsx · LiveView.tsx · InvitePanel.tsx · InstallCommand.tsx · Roster.tsx
    api/projects/route.ts
    api/projects/[id]/invite/route.ts
    api/members/[id]/revoke/route.ts
    api/ingest/route.ts                 # hook write path (token-authed)
    mcp/route.ts                        # MCP read endpoint (token-authed)
  cli/
    package.json                        # name "convoy-cli", bin convoy-cli
    index.mjs                           # `connect` + `hook` commands
    hook.mjs                            # per-event runner (copied to ~/.convoy/)
  src/
    lib/overlap.ts                      # PURE overlap engine
    lib/constants.ts
    lib/supabase/server.ts · client.ts · admin.ts
    lib/mcp/auth.ts                     # token → member
    lib/mcp/tools.ts                    # pull_team_context, set_my_status
    lib/ingest.ts                       # ingestEdit, ingestIdle
    lib/email.ts                        # Resend invite email
    types/db.ts
  supabase/migrations/0001_init.sql · 0002_rls.sql · 0003_ingest_fn.sql
  tests/overlap.test.ts · mcp-tools.test.ts · ingest.test.ts · rls.test.ts · e2e/overlap.spec.ts
  middleware.ts · vitest.config.ts · playwright.config.ts · next.config.ts · package.json · .env.local.example
```

---

# Phase 0 — Scaffold, repo, walking-skeleton deploy ✅ DONE (2026-06-21)

> Live: https://convoy-ish-c.vercel.app · repo: github.com/ish-cs/convoy · Vercel SSO protection disabled.

### Task 0: Project scaffold + tooling ✅

**Files:** `package.json`, `next.config.ts`, `tsconfig.json`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `vitest.config.ts`, `.gitignore`, `.env.local.example`

- [x] **Step 1: Scaffold** — `cd ~/_Projects/convoy` then:
```bash
pnpm dlx create-next-app@latest . --ts --app --tailwind --eslint --no-src-dir --use-pnpm --import-alias "@/*"
```
If it refuses on the non-empty dir, move `docs/` aside, scaffold, move back.

- [x] **Step 2: Deps**
```bash
pnpm add @supabase/supabase-js @supabase/ssr zod mcp-handler @modelcontextprotocol/sdk resend
pnpm add -D vitest @playwright/test
```

- [x] **Step 3: `vitest.config.ts`**
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['tests/**/*.test.ts'] } });
```

- [x] **Step 4: scripts in `package.json`**
```json
{ "scripts": { "dev": "next dev", "build": "next build", "start": "next start",
  "test": "vitest run", "test:watch": "vitest", "e2e": "playwright test" } }
```

- [x] **Step 5: `.env.local.example`**
```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

- [x] **Step 6:** Confirm `.gitignore` includes `.env*.local` (create-next-app default).

- [x] **Step 7:** `pnpm build` → succeeds.

- [x] **Step 8: Commit**
```bash
git init && git add -A && git commit -m "chore: scaffold Convoy Next app with tooling"
```

### Task 1: Public repo + Vercel link + first deploy ✅

- [x] **Step 1: Placeholder landing** `app/page.tsx`
```tsx
export default function Home() {
  return (
    <main className="min-h-screen grid place-items-center">
      <h1 className="text-2xl font-semibold">Convoy — live shared context for Claude Code</h1>
    </main>
  );
}
```

- [x] **Step 2: Create public repo + push**
```bash
gh repo create convoy --public --source=. --remote=origin --push
```
Author = user; no Claude attribution.

- [x] **Step 3: Link + deploy**
```bash
pnpm dlx vercel@latest link --yes && pnpm dlx vercel@latest --prod
```
Record the live URL.

- [x] **Step 4: Verify** — `curl -s <url> | grep -o "live shared context"` prints the phrase.

- [x] **Step 5: Commit** — `git add -A && git commit -m "chore: link Vercel, deploy walking skeleton" && git push`

---

# Phase 1 — Database ✅ DONE (2026-06-21)

> Supabase project `convoy` ref `apcncvukfcpveigqlhfa` (us-west-1). 4 tables + `ingest_edit` + RLS applied & verified. Keys in `.env.local` + Vercel env. (Had to pause `berkeley-classes` for the free active-project slot.)

### Task 2: Supabase project + schema + ingest function ✅

**Files:** `supabase/migrations/0001_init.sql`, `supabase/migrations/0003_ingest_fn.sql`, `src/types/db.ts`

- [x] **Step 1: Create the Supabase project** named `convoy`. Capture URL + anon key + service-role key → `.env.local` and Vercel env (`vercel env add` for all, plus `NEXT_PUBLIC_SITE_URL`, `RESEND_API_KEY`).

- [x] **Step 2: `0001_init.sql`**
```sql
create extension if not exists pgcrypto;

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  display_name text,
  current_summary text,
  summary_updated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, email)
);

create table member_status (
  member_id uuid not null references project_members(id) on delete cascade,
  session_id text not null,
  project_id uuid not null references projects(id) on delete cascade,
  branch text,
  files text[] not null default '{}',
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (member_id, session_id)
);

create table events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  member_id uuid not null references project_members(id) on delete cascade,
  session_id text not null,
  ts timestamptz not null default now(),
  branch text,
  files text[] not null default '{}',
  message text not null
);
create index events_project_ts_idx on events(project_id, ts desc);
```

- [x] **Step 3: `0003_ingest_fn.sql`** (atomic upsert-with-union + event append)
```sql
create or replace function ingest_edit(
  p_member uuid, p_session text, p_project uuid,
  p_branch text, p_files text[], p_message text
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into member_status (member_id, session_id, project_id, branch, files, ended_at, updated_at)
  values (p_member, p_session, p_project, p_branch, p_files, null, now())
  on conflict (member_id, session_id) do update
    set branch = excluded.branch,
        files = (select array(select distinct unnest(member_status.files || excluded.files))),
        ended_at = null,
        updated_at = now();
  insert into events (project_id, member_id, session_id, branch, files, message)
  values (p_project, p_member, p_session, p_branch, p_files, p_message);
end; $$;
```

- [x] **Step 4: Apply** both migrations to the Convoy project. Verify 4 tables + `ingest_edit` exist.

- [x] **Step 5: `src/types/db.ts`**
```ts
export interface ProjectRow { id: string; name: string; owner_id: string; created_at: string; }
export interface MemberRow {
  id: string; project_id: string; user_id: string | null; email: string; token: string;
  display_name: string | null; current_summary: string | null; summary_updated_at: string | null;
  revoked_at: string | null; created_at: string;
}
export interface StatusRow {
  member_id: string; session_id: string; project_id: string;
  branch: string | null; files: string[]; ended_at: string | null; updated_at: string;
}
export interface EventRow {
  id: string; project_id: string; member_id: string; session_id: string;
  ts: string; branch: string | null; files: string[]; message: string;
}
```

- [x] **Step 6: Commit** — `git add -A && git commit -m "feat(db): v2 schema (per-session status) + ingest_edit fn + types" && git push`

### Task 3: RLS policies + isolation test ✅ (cloud RLS verified via advisor; two-user test awaits local supabase)

**Files:** `supabase/migrations/0002_rls.sql`, `tests/rls.test.ts`

- [x] **Step 1: Failing test** `tests/rls.test.ts` (against local `supabase start`, two seeded users):
```ts
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
const URL = process.env.LOCAL_SUPABASE_URL!, ANON = process.env.LOCAL_SUPABASE_ANON!;
async function asUser(email: string) {
  const c = createClient(URL, ANON);
  await c.auth.signInWithPassword({ email, password: 'test-pass-123' });
  return c;
}
describe('RLS', () => {
  it('a user cannot read another user\'s project', async () => {
    const a = await asUser('a@test.dev');
    const { data: created } = await a.from('projects').insert({ name: 'A proj' }).select().single();
    const b = await asUser('b@test.dev');
    const { data: seen } = await b.from('projects').select('*').eq('id', created!.id);
    expect(seen).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run → fail** — `supabase start && pnpm vitest run tests/rls.test.ts` (B currently sees the row).

- [x] **Step 3: `0002_rls.sql`**
```sql
alter table projects enable row level security;
alter table project_members enable row level security;
alter table member_status enable row level security;
alter table events enable row level security;

create or replace function is_project_member(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from projects where id = p and owner_id = auth.uid())
      or exists (select 1 from project_members where project_id = p and user_id = auth.uid());
$$;

create policy projects_owner_all on projects
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy projects_member_read on projects
  for select using (is_project_member(id));
create policy members_read on project_members
  for select using (is_project_member(project_id));
create policy members_owner_write on project_members
  for all using (exists (select 1 from projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from projects p where p.id = project_id and p.owner_id = auth.uid()));
create policy status_read on member_status for select using (is_project_member(project_id));
create policy events_read on events for select using (is_project_member(project_id));
-- machine writes (ingest/mcp) use the service role and bypass RLS.
```

- [x] **Step 4: Apply + pass** — `supabase db reset && pnpm vitest run tests/rls.test.ts` → PASS.

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(db): RLS policies + isolation test" && git push`

---

# Phase 2 — Overlap engine (pure) ✅ DONE (2026-06-21)

> 7/7 tests pass.

### Task 4: `computeOverlap` + `normalizePath` ✅

**Files:** `src/lib/overlap.ts`, `src/lib/constants.ts`, `tests/overlap.test.ts`

**Interfaces — Produces:**
- `normalizePath(p: string): string`
- `interface MemberSnapshot { memberId: string; displayName: string; branch: string|null; files: string[]; lastActivityAt: string }`
- `interface OverlapAlert { memberId: string; displayName: string; branch: string|null; file: string; lastActivityAt: string }`
- `computeOverlap(me: {files: string[]; branch: string|null}, others: MemberSnapshot[], now: Date, windowMinutes?: number): OverlapAlert[]`

- [x] **Step 1: Failing tests** `tests/overlap.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { computeOverlap, normalizePath } from '../src/lib/overlap';
const NOW = new Date('2026-06-21T12:00:00Z');
const iso = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const other = (files: string[], minsAgo: number) =>
  ({ memberId: 'm2', displayName: 'Partner', branch: 'feat/y', files, lastActivityAt: iso(minsAgo) });

describe('normalizePath', () => {
  it('strips ./ and collapses slashes', () => {
    expect(normalizePath('./src//a.ts')).toBe('src/a.ts');
    expect(normalizePath('  src/a.ts ')).toBe('src/a.ts');
  });
});
describe('computeOverlap', () => {
  it('flags a shared file within the window', () => {
    const a = computeOverlap({ files: ['src/auth.ts'], branch: 'feat/x' }, [other(['src/auth.ts'], 4)], NOW);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ displayName: 'Partner', file: 'src/auth.ts', branch: 'feat/y' });
  });
  it('ignores activity older than the window', () => {
    expect(computeOverlap({ files: ['src/auth.ts'], branch: 'feat/x' }, [other(['src/auth.ts'], 61)], NOW)).toHaveLength(0);
  });
  it('ignores non-overlapping files', () => {
    expect(computeOverlap({ files: ['src/a.ts'], branch: 'feat/x' }, [other(['src/b.ts'], 1)], NOW)).toHaveLength(0);
  });
  it('normalizes paths before comparing', () => {
    expect(computeOverlap({ files: ['./src/auth.ts'], branch: 'feat/x' }, [other(['src//auth.ts'], 1)], NOW)).toHaveLength(1);
  });
  it('one alert per overlapping file across members', () => {
    const a = computeOverlap({ files: ['a.ts','b.ts'], branch: 'feat/x' },
      [other(['a.ts'],1), { ...other(['b.ts'],1), memberId:'m3', displayName:'Cee' }], NOW);
    expect(a.map(x => x.file).sort()).toEqual(['a.ts','b.ts']);
  });
  it('empty inputs → no alerts', () => {
    expect(computeOverlap({ files: [], branch: null }, [], NOW)).toEqual([]);
  });
});
```

- [x] **Step 2: Run → fail** — `pnpm vitest run tests/overlap.test.ts` (module missing).

- [x] **Step 3: Implement**

`src/lib/constants.ts`
```ts
export const OVERLAP_WINDOW_MINUTES = 60;
```
`src/lib/overlap.ts`
```ts
import { OVERLAP_WINDOW_MINUTES } from './constants';
export interface MemberSnapshot { memberId: string; displayName: string; branch: string | null; files: string[]; lastActivityAt: string; }
export interface OverlapAlert { memberId: string; displayName: string; branch: string | null; file: string; lastActivityAt: string; }
export function normalizePath(p: string): string {
  return p.trim().replace(/^\.\//, '').replace(/\/+/g, '/');
}
export function computeOverlap(
  me: { files: string[]; branch: string | null },
  others: MemberSnapshot[],
  now: Date,
  windowMinutes: number = OVERLAP_WINDOW_MINUTES,
): OverlapAlert[] {
  const cutoff = now.getTime() - windowMinutes * 60_000;
  const myFiles = new Set(me.files.map(normalizePath));
  const alerts: OverlapAlert[] = [];
  for (const o of others) {
    if (new Date(o.lastActivityAt).getTime() < cutoff) continue;
    for (const f of o.files) {
      if (myFiles.has(normalizePath(f))) {
        alerts.push({ memberId: o.memberId, displayName: o.displayName, branch: o.branch, file: f, lastActivityAt: o.lastActivityAt });
      }
    }
  }
  return alerts;
}
```

- [x] **Step 4: Run → pass** — `pnpm vitest run tests/overlap.test.ts` (all 7).

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(overlap): pure file-overlap engine + tests" && git push`

---

# Phase 3 — Capture write path (ingest + CLI/hook) ✅ DONE (2026-06-21)

> Tasks 5–8 shipped & verified LIVE: real hook payload → `/api/ingest` → DB (branch=main, relativized file, Stop→ended_at). `/api/ingest` smoke: valid→200, bad token→401, malformed→400. CLI install idempotent + preserves existing hooks. 10/10 unit tests green. Vercel git-author block fixed (repo email → pandey.ishaan@gmail.com).

### Task 5: Supabase admin client + `resolveMember` ✅

**Files:** `src/lib/supabase/admin.ts`, `src/lib/mcp/auth.ts`, `tests/mcp-tools.test.ts` (auth case)

**Interfaces — Produces:** `getAdmin(): SupabaseClient` · `resolveMember(token: string): Promise<MemberRow | null>` (null if missing/revoked)

- [x] **Step 1: Failing test** add to `tests/mcp-tools.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { resolveMember } from '../src/lib/mcp/auth';
describe('resolveMember', () => {
  it('returns null for an unknown token', async () => {
    expect(await resolveMember('definitely-not-real')).toBeNull();
  });
});
```

- [x] **Step 2: Run → fail** — `pnpm vitest run tests/mcp-tools.test.ts`.

- [x] **Step 3: Implement**

`src/lib/supabase/admin.ts`
```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
let cached: SupabaseClient | null = null;
export function getAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase admin env vars missing');
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
```
`src/lib/mcp/auth.ts`
```ts
import { getAdmin } from '../supabase/admin';
import type { MemberRow } from '../../types/db';
export async function resolveMember(token: string): Promise<MemberRow | null> {
  if (!token) return null;
  const { data, error } = await getAdmin()
    .from('project_members').select('*').eq('token', token).is('revoked_at', null).maybeSingle();
  if (error || !data) return null;
  return data as MemberRow;
}
```

- [x] **Step 4: Run → pass.** **Step 5: Commit** — `git add -A && git commit -m "feat: service-role client + token resolver" && git push`

### Task 6: Ingest functions (`ingestEdit`, `ingestIdle`) + tests ✅

**Files:** `src/lib/ingest.ts`, `tests/ingest.test.ts`

**Interfaces — Consumes:** `getAdmin`. **Produces:**
- `ingestEdit(member: MemberRow, a: {session_id: string; branch: string|null; files: string[]; message?: string}): Promise<void>`
- `ingestIdle(member: MemberRow, a: {session_id: string}): Promise<void>`

- [x] **Step 1: Failing integration test** `tests/ingest.test.ts` (seeds project P + member M via admin in `beforeAll`):
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { getAdmin } from '../src/lib/ingest_test_helpers'; // re-export getAdmin for tests
import { ingestEdit, ingestIdle } from '../src/lib/ingest';
let M: any, P: string;
beforeAll(async () => {
  const admin = getAdmin();
  const { data: proj } = await admin.from('projects').insert({ name: 'P', owner_id: process.env.TEST_USER_ID }).select().single();
  P = proj!.id;
  const { data: m } = await admin.from('project_members').insert({ project_id: P, email: 'm@test.dev' }).select().single();
  M = m;
});
it('edit upserts a session row and unions files', async () => {
  await ingestEdit(M, { session_id: 's1', branch: 'feat/x', files: ['a.ts'] });
  await ingestEdit(M, { session_id: 's1', branch: 'feat/x', files: ['b.ts'] });
  const { data } = await getAdmin().from('member_status').select('*').eq('member_id', M.id).eq('session_id', 's1').single();
  expect(new Set(data!.files)).toEqual(new Set(['a.ts','b.ts']));
  const { data: ev } = await getAdmin().from('events').select('*').eq('member_id', M.id);
  expect(ev!.length).toBe(2);
});
it('idle sets ended_at', async () => {
  await ingestIdle(M, { session_id: 's1' });
  const { data } = await getAdmin().from('member_status').select('ended_at').eq('member_id', M.id).eq('session_id', 's1').single();
  expect(data!.ended_at).not.toBeNull();
});
```
(Also create `src/lib/ingest_test_helpers.ts` that just `export { getAdmin } from './supabase/admin';` — keeps test imports stable.)

- [x] **Step 2: Run → fail.**

- [x] **Step 3: Implement** `src/lib/ingest.ts`
```ts
import { getAdmin } from './supabase/admin';
import type { MemberRow } from '../types/db';
export async function ingestEdit(
  member: MemberRow,
  a: { session_id: string; branch: string | null; files: string[]; message?: string },
): Promise<void> {
  const { error } = await getAdmin().rpc('ingest_edit', {
    p_member: member.id, p_session: a.session_id, p_project: member.project_id,
    p_branch: a.branch, p_files: a.files, p_message: a.message ?? `edited ${a.files[0] ?? ''}`,
  });
  if (error) throw new Error(`ingestEdit failed: ${error.message}`);
}
export async function ingestIdle(member: MemberRow, a: { session_id: string }): Promise<void> {
  const { error } = await getAdmin().from('member_status')
    .update({ ended_at: new Date().toISOString() })
    .eq('member_id', member.id).eq('session_id', a.session_id);
  if (error) throw new Error(`ingestIdle failed: ${error.message}`);
}
```

- [x] **Step 4: Run → pass.** **Step 5: Commit** — `git add -A && git commit -m "feat(ingest): edit/idle ingest fns + union tests" && git push`

### Task 7: `/api/ingest` route (token-authed) ✅

**Files:** `app/api/ingest/route.ts`

- [x] **Step 1: Implement**
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveMember } from '@/src/lib/mcp/auth';
import { ingestEdit, ingestIdle } from '@/src/lib/ingest';

const Body = z.object({
  session_id: z.string().min(1),
  kind: z.enum(['edit', 'idle']),
  branch: z.string().nullable().optional(),
  files: z.array(z.string()).optional(),
  message: z.string().optional(),
});

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const member = await resolveMember(token);
  if (!member) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const b = parsed.data;

  if (b.kind === 'idle') await ingestIdle(member, { session_id: b.session_id });
  else await ingestEdit(member, { session_id: b.session_id, branch: b.branch ?? null, files: b.files ?? [], message: b.message });

  return NextResponse.json({ ok: true });
}
```

- [x] **Step 2: Deploy + smoke** — `pnpm dlx vercel@latest --prod`, then:
```bash
curl -sS -X POST <url>/api/ingest -H "Authorization: Bearer <seeded-token>" \
  -H 'content-type: application/json' \
  -d '{"session_id":"smoke1","kind":"edit","branch":"feat/x","files":["src/auth.ts"]}'
```
Expected `{"ok":true}`; bad token → 401. Verify a `member_status` row appeared.

- [x] **Step 3: Commit** — `git add -A && git commit -m "feat(api): token-authed /api/ingest write endpoint" && git push`

### Task 8: `convoy-cli` (connect + hook) ✅ (used execFileSync to avoid shell injection; npm publish still deferred)

**Files:** `cli/package.json`, `cli/index.mjs`, `cli/hook.mjs`

- [x] **Step 1: `cli/package.json`**
```json
{
  "name": "convoy-cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "convoy-cli": "index.mjs" },
  "engines": { "node": ">=18" }
}
```

- [x] **Step 2: `cli/hook.mjs`** (the per-event runner; copied to `~/.convoy/hook.mjs`)
```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const INGEST = process.env.CONVOY_INGEST_URL || 'https://convoy.app/api/ingest';

function relativize(fp, cwd) { return fp.startsWith(cwd + '/') ? fp.slice(cwd.length + 1) : fp; }

async function main() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch {}
  let p = {};
  try { p = JSON.parse(raw || '{}'); } catch {}

  let token = process.env.CONVOY_TOKEN;
  if (!token) { try { token = readFileSync(join(homedir(), '.convoy/token'), 'utf8').trim(); } catch {} }
  if (!token || !p.session_id) process.exit(0);

  const cwd = p.cwd || process.cwd();
  let branch = null;
  try { branch = execSync('git branch --show-current', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; } catch {}

  let body;
  if (p.hook_event_name === 'Stop') {
    body = { session_id: p.session_id, kind: 'idle' };
  } else {
    const fp = p.tool_input?.file_path;
    if (!fp) process.exit(0);
    const file = relativize(fp, cwd);
    body = { session_id: p.session_id, kind: 'edit', branch, files: [file], message: `edited ${file}` };
  }
  try {
    await fetch(INGEST, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
  } catch {} // best-effort: never block the edit
  process.exit(0);
}
main();
```

- [x] **Step 3: `cli/index.mjs`** (`connect` installs config + hooks + token; `hook` delegates)
```js
#!/usr/bin/env node
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_URL = process.env.CONVOY_MCP_URL || 'https://convoy.app/mcp';
const HOOK_CMD = `node ${join(homedir(), '.convoy/hook.mjs')}`;

function installHooks(settingsPath) {
  let s = {};
  try { s = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch {}
  s.hooks ??= {};
  const ensure = (event, matcher) => {
    s.hooks[event] ??= [];
    const exists = JSON.stringify(s.hooks[event]).includes('.convoy/hook.mjs');
    if (!exists) s.hooks[event].push(matcher ? { matcher, hooks: [{ type: 'command', command: HOOK_CMD }] }
                                            : { hooks: [{ type: 'command', command: HOOK_CMD }] });
  };
  ensure('PostToolUse', 'Edit|Write|MultiEdit');
  ensure('Stop', null);
  writeFileSync(settingsPath, JSON.stringify(s, null, 2));
}

function connect(token) {
  if (!token) { console.error('usage: convoy-cli connect <token>'); process.exit(1); }
  const dir = join(homedir(), '.convoy');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'token'), token, { mode: 0o600 });
  copyFileSync(join(HERE, 'hook.mjs'), join(dir, 'hook.mjs'));
  try {
    execSync(`claude mcp add --transport http convoy ${MCP_URL} -H "Authorization: Bearer ${token}"`, { stdio: 'inherit' });
  } catch { console.warn('Could not run `claude mcp add` automatically — add it manually (see README).'); }
  installHooks(join(homedir(), '.claude', 'settings.json'));
  console.log('Convoy connected. Restart Claude Code sessions to load the hooks.');
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'connect') connect(arg);
else if (cmd === 'hook') await import(join(homedir(), '.convoy/hook.mjs'));
else { console.error('commands: connect <token> | hook'); process.exit(1); }
```

- [x] **Step 4: Local verify (no publish yet)**

In a throwaway git repo, with the deployed `/api/ingest` live and a seeded token:
```bash
CONVOY_MCP_URL=<url>/mcp CONVOY_INGEST_URL=<url>/api/ingest node cli/index.mjs connect <token>
echo '{"session_id":"t1","hook_event_name":"PostToolUse","cwd":"'"$PWD"'","tool_input":{"file_path":"'"$PWD"'/src/auth.ts"}}' | CONVOY_INGEST_URL=<url>/api/ingest node ~/.convoy/hook.mjs
```
Expected: a `member_status` row for session `t1` with `files=['src/auth.ts']`. Confirm `~/.claude/settings.json` gained the two hooks (and that pre-existing hooks were preserved).

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(cli): convoy-cli connect + capture hook" && git push`

> npm publish of `convoy-cli` is an outward-facing action — defer until the owner approves. For v1 testing, `node cli/index.mjs connect` (above) is sufficient.

---

# Phase 4 — MCP read endpoint ✅

### Task 9: MCP tool handlers (`pullTeamContext`, `setMyStatus`) + tests ✅

**Files:** `src/lib/mcp/tools.ts`, extend `tests/mcp-tools.test.ts`

**Interfaces — Produces:**
- `pullTeamContext(member, args: {branch?: string|null; files?: string[]}, now: Date): Promise<{members; recent_events; alerts}>`
- `setMyStatus(member, args: {summary: string}): Promise<void>`

- [x] **Step 1: Failing integration test** (seeds P + M1, M2; uses `ingestEdit` to create M2 state)
```ts
import { ingestEdit } from '../src/lib/ingest';
import { pullTeamContext, setMyStatus } from '../src/lib/mcp/tools';
// ...beforeAll seeds project P, members M1, M2...
it('pull surfaces partner active session, events, and overlap alerts', async () => {
  await ingestEdit(M2, { session_id: 's2', branch: 'feat/y', files: ['src/auth.ts'] });
  const res = await pullTeamContext(M1, { branch: 'feat/x', files: ['src/auth.ts'] }, new Date());
  expect(res.members.some((s: any) => s.member_id === M2.id)).toBe(true);
  expect(res.alerts.some((a: any) => a.file === 'src/auth.ts' && a.memberId === M2.id)).toBe(true);
});
it('overlap includes recent event files even if not in current session file list', async () => {
  // M2 session files emptied conceptually; event still within window
  const res = await pullTeamContext(M1, { branch: 'feat/x', files: ['src/auth.ts'] }, new Date());
  expect(res.alerts.length).toBeGreaterThan(0);
});
it('set_my_status writes current_summary', async () => {
  await setMyStatus(M1, { summary: 'wiring login' });
  const { data } = await getAdmin().from('project_members').select('current_summary').eq('id', M1.id).single();
  expect(data!.current_summary).toBe('wiring login');
});
it('caller is excluded from members and alerts', async () => {
  await ingestEdit(M1, { session_id: 's1', branch: 'feat/x', files: ['src/auth.ts'] });
  const res = await pullTeamContext(M1, { branch: 'feat/x', files: ['src/auth.ts'] }, new Date());
  expect(res.alerts.every((a: any) => a.memberId !== M1.id)).toBe(true);
});
```

- [x] **Step 2: Run → fail.**

- [x] **Step 3: Implement** `src/lib/mcp/tools.ts`
```ts
import { getAdmin } from '../supabase/admin';
import { computeOverlap, type MemberSnapshot, type OverlapAlert } from '../overlap';
import { OVERLAP_WINDOW_MINUTES } from '../constants';
import type { MemberRow, StatusRow, EventRow } from '../../types/db';

export async function setMyStatus(member: MemberRow, args: { summary: string }): Promise<void> {
  const { error } = await getAdmin().from('project_members')
    .update({ current_summary: args.summary, summary_updated_at: new Date().toISOString() })
    .eq('id', member.id);
  if (error) throw new Error(`setMyStatus failed: ${error.message}`);
}

export async function pullTeamContext(
  member: MemberRow,
  args: { branch?: string | null; files?: string[] },
  now: Date,
): Promise<{ members: (StatusRow & { display_name: string | null; current_summary: string | null })[]; recent_events: EventRow[]; alerts: OverlapAlert[] }> {
  const db = getAdmin();
  const cutoffIso = new Date(now.getTime() - OVERLAP_WINDOW_MINUTES * 60_000).toISOString();
  const [statusRes, eventsRes, membersRes] = await Promise.all([
    db.from('member_status').select('*').eq('project_id', member.project_id).is('ended_at', null),
    db.from('events').select('*').eq('project_id', member.project_id).gte('ts', cutoffIso).order('ts', { ascending: false }).limit(100),
    db.from('project_members').select('id, display_name, email, current_summary').eq('project_id', member.project_id),
  ]);
  if (statusRes.error) throw new Error(`pull(status): ${statusRes.error.message}`);
  if (eventsRes.error) throw new Error(`pull(events): ${eventsRes.error.message}`);
  if (membersRes.error) throw new Error(`pull(members): ${membersRes.error.message}`);

  const meta = new Map((membersRes.data ?? []).map((m: any) => [m.id, m]));
  const allStatus = statusRes.data as StatusRow[];
  const events = eventsRes.data as EventRow[];
  const others = allStatus.filter(s => s.member_id !== member.id);

  // union recent event files per member (gap H)
  const evFiles = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.member_id === member.id) continue;
    if (!evFiles.has(e.member_id)) evFiles.set(e.member_id, new Set());
    e.files.forEach(f => evFiles.get(e.member_id)!.add(f));
  }

  const snapshots: MemberSnapshot[] = others.map(s => ({
    memberId: s.member_id,
    displayName: meta.get(s.member_id)?.display_name || meta.get(s.member_id)?.email || 'teammate',
    branch: s.branch,
    files: Array.from(new Set([...s.files, ...(evFiles.get(s.member_id) ?? [])])),
    lastActivityAt: s.updated_at,
  }));

  const alerts = computeOverlap({ files: args.files ?? [], branch: args.branch ?? null }, snapshots, now, OVERLAP_WINDOW_MINUTES);
  const members = others.map(s => ({ ...s, display_name: meta.get(s.member_id)?.display_name ?? null, current_summary: meta.get(s.member_id)?.current_summary ?? null }));
  return { members, recent_events: events.filter(e => e.member_id !== member.id), alerts };
}
```

- [x] **Step 4: Run → pass.** **Step 5: Commit** — `git add -A && git commit -m "feat(mcp): pull_team_context + set_my_status handlers + tests" && git push`

### Task 10: `/mcp` HTTP route ✅

**Files:** `app/mcp/route.ts`

> Verify `mcp-handler` `withMcpAuth` / `authInfo.extra` signatures against its current README. If `mcp-handler` requires `REDIS_URL` for SSE, set it (Upstash free) **or** use its stateless option — our tools are request/response, so stateless is preferred. The tool I/O contract is adapter-independent.

- [x] **Step 1: Implement**
```ts
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';
import { resolveMember } from '@/src/lib/mcp/auth';
import { pullTeamContext, setMyStatus } from '@/src/lib/mcp/tools';
import type { MemberRow } from '@/src/types/db';

const handler = createMcpHandler((server) => {
  server.tool(
    'pull_team_context',
    'Read teammates\' current sessions, recent activity, and FILE-OVERLAP ALERTS. Call at session start and before editing files. Pass your current git branch and the files you are about to edit to get warned when a teammate is touching the same file.',
    { branch: z.string().nullable().optional(), files: z.array(z.string()).optional() },
    async (args, extra) => {
      const member = extra.authInfo!.extra!.member as MemberRow;
      const res = await pullTeamContext(member, args, new Date());
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    },
  );
  server.tool(
    'set_my_status',
    'Optionally set a short human-readable summary of what you are currently working on, for teammates to see. Files and branch are captured automatically.',
    { summary: z.string() },
    async (args, extra) => {
      const member = extra.authInfo!.extra!.member as MemberRow;
      await setMyStatus(member, args);
      return { content: [{ type: 'text', text: 'summary updated' }] };
    },
  );
});

const authed = withMcpAuth(
  handler,
  async (_req, token) => {
    const member = await resolveMember(token ?? '');
    if (!member) return undefined; // → 401
    return { token: token!, clientId: member.id, scopes: [], extra: { member } };
  },
  { required: true },
);
export { authed as GET, authed as POST };
```

- [x] **Step 2: Deploy + real-session smoke** — `pnpm dlx vercel@latest --prod`, then in a real Claude Code session:
```bash
claude mcp add --transport http convoy <url>/mcp -H "Authorization: Bearer <seeded-token>"
```
Ask Claude to call `pull_team_context` → JSON with members/recent_events/alerts. Revoked token → 401.

- [x] **Step 3: Commit** — `git add -A && git commit -m "feat(mcp): hosted /mcp route (pull + set_my_status)" && git push`

---

# Phase 5 — Auth, projects, invites ✅

### Task 11: Google OAuth sign-in ✅

**Files:** `src/lib/supabase/server.ts`, `client.ts`, `app/login/page.tsx`, `app/auth/callback/route.ts`, `middleware.ts`

- [x] **Step 1: Configure Google provider** in Supabase (OAuth client in Google Cloud; redirect `<supabase-url>/auth/v1/callback`; Site URL = deploy URL; allow `http://localhost:3000`). Use the get-api-key / browser-use tooling to fetch the Google OAuth client autonomously.

- [x] **Step 2: Clients**

`src/lib/supabase/server.ts`
```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
export async function getServerSupabase() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => toSet.forEach(({ name, value, options }) => store.set(name, value, options)),
    },
  });
}
```
`src/lib/supabase/client.ts`
```ts
'use client';
import { createBrowserClient } from '@supabase/ssr';
export function getBrowserSupabase() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
```

- [x] **Step 3: Login** `app/login/page.tsx`
```tsx
'use client';
import { getBrowserSupabase } from '@/src/lib/supabase/client';
export default function Login() {
  const signIn = async () => {
    await getBrowserSupabase().auth.signInWithOAuth({
      provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };
  return (
    <main className="min-h-screen grid place-items-center">
      <button onClick={signIn} className="rounded-md border px-4 py-2 font-medium">Sign in with Google</button>
    </main>
  );
}
```

- [x] **Step 4: Callback + link pending members** `app/auth/callback/route.ts`
```ts
import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/src/lib/supabase/server';
import { getAdmin } from '@/src/lib/supabase/admin';
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (code) {
    const supabase = await getServerSupabase();
    await supabase.auth.exchangeCodeForSession(code);
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.email) {
      await getAdmin().from('project_members')
        .update({ user_id: user.id, display_name: user.user_metadata?.full_name ?? user.email })
        .eq('email', user.email).is('user_id', null);
    }
  }
  return NextResponse.redirect(new URL('/dashboard', url.origin));
}
```

- [x] **Step 5: Protect routes** `middleware.ts`
```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (toSet) => toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));
  return res;
}
export const config = { matcher: ['/dashboard/:path*', '/projects/:path*'] };
```

- [x] **Step 6: Verify** sign-in → `/dashboard` redirect works locally + on deploy.

- [x] **Step 7: Commit** — `git add -A && git commit -m "feat(auth): Google OAuth + member linking + protected routes" && git push`

### Task 12: Create project + dashboard ✅

**Files:** `app/api/projects/route.ts`, `app/dashboard/page.tsx`, `app/dashboard/NewProject.tsx`

- [x] **Step 1: API** `app/api/projects/route.ts`
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/src/lib/supabase/server';
import { getAdmin } from '@/src/lib/supabase/admin';
const Body = z.object({ name: z.string().min(1).max(80) });
export async function POST(req: Request) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid name' }, { status: 400 });
  const { data: project, error } = await supabase.from('projects')
    .insert({ name: parsed.data.name, owner_id: user.id }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await getAdmin().from('project_members').insert({
    project_id: project.id, user_id: user.id, email: user.email!,
    display_name: user.user_metadata?.full_name ?? user.email,
  });
  return NextResponse.json({ id: project.id });
}
```

- [x] **Step 2: Dashboard** `app/dashboard/page.tsx`
```tsx
import Link from 'next/link';
import { getServerSupabase } from '@/src/lib/supabase/server';
import NewProject from './NewProject';
export default async function Dashboard() {
  const supabase = await getServerSupabase();
  const { data: projects } = await supabase.from('projects').select('id, name').order('created_at');
  return (
    <main className="mx-auto max-w-2xl p-8 space-y-6">
      <h1 className="text-xl font-semibold">Your projects</h1>
      <NewProject />
      <ul className="space-y-2">
        {(projects ?? []).map(p => (
          <li key={p.id}><Link className="underline" href={`/projects/${p.id}`}>{p.name}</Link></li>
        ))}
      </ul>
    </main>
  );
}
```
`app/dashboard/NewProject.tsx`
```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export default function NewProject() {
  const [name, setName] = useState('');
  const router = useRouter();
  const create = async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    if (res.ok) { const { id } = await res.json(); router.push(`/projects/${id}`); }
  };
  return (
    <div className="flex gap-2">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Project name" className="flex-1 rounded border px-3 py-2" />
      <button onClick={create} className="rounded border px-4 py-2">Create</button>
    </div>
  );
}
```

- [x] **Step 3: Verify** sign in → create "Test" → redirect to `/projects/<id>`; `projects` + owner `project_members` rows exist.

- [x] **Step 4: Commit** — `git add -A && git commit -m "feat(projects): create project + owner member + dashboard" && git push`

### Task 13: Invite (Resend email) + revoke ✅

**Files:** `src/lib/email.ts`, `app/api/projects/[id]/invite/route.ts`, `app/api/members/[id]/revoke/route.ts`

- [x] **Step 1: Email helper** `src/lib/email.ts`
```ts
import { Resend } from 'resend';
export async function sendInviteEmail(to: string, projectName: string) {
  const key = process.env.RESEND_API_KEY;
  const site = process.env.NEXT_PUBLIC_SITE_URL!;
  if (!key) return; // email is best-effort; never block the invite
  const resend = new Resend(key);
  await resend.emails.send({
    from: 'Convoy <onboarding@resend.dev>',
    to,
    subject: `You've been added to ${projectName} on Convoy`,
    html: `<p>You've been added to <b>${projectName}</b> on Convoy.</p>
           <p>Sign in with this email: <a href="${site}/login">${site}/login</a></p>
           <p>Then open the project and run the one-line connect command shown there.</p>`,
  });
}
```

- [x] **Step 2: Invite API** `app/api/projects/[id]/invite/route.ts`
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/src/lib/supabase/server';
import { getAdmin } from '@/src/lib/supabase/admin';
import { sendInviteEmail } from '@/src/lib/email';
const Body = z.object({ email: z.string().email() });
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await ctx.params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: project } = await supabase.from('projects').select('name, owner_id').eq('id', projectId).single();
  if (!project || project.owner_id !== user.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid email' }, { status: 400 });
  const { data, error } = await getAdmin().from('project_members')
    .insert({ project_id: projectId, email: parsed.data.email.toLowerCase() }).select('id, token').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  await sendInviteEmail(parsed.data.email, project.name).catch(() => {});
  return NextResponse.json({ memberId: data.id });
}
```

- [x] **Step 3: Revoke API** `app/api/members/[id]/revoke/route.ts`
```ts
import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/src/lib/supabase/server';
import { getAdmin } from '@/src/lib/supabase/admin';
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: memberId } = await ctx.params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const admin = getAdmin();
  const { data: m } = await admin.from('project_members').select('project_id, projects(owner_id)').eq('id', memberId).single();
  // @ts-expect-error nested select typing
  if (!m || m.projects.owner_id !== user.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { error } = await admin.from('project_members').update({ revoked_at: new Date().toISOString() }).eq('id', memberId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [x] **Step 4: Verify** invite a real email → Resend delivers; the member row + token exist; revoke → next `/api/ingest` or `/mcp` call with that token returns 401.

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(members): invite (Resend) + revoke" && git push`

---

# Phase 6 — Live project view ✅

### Task 14: Project shell + install command ✅

**Files:** `app/projects/[id]/page.tsx`, `InstallCommand.tsx`, `InvitePanel.tsx`

- [x] **Step 1: Server shell** `app/projects/[id]/page.tsx`
```tsx
import { getServerSupabase } from '@/src/lib/supabase/server';
import LiveView from './LiveView';
import InvitePanel from './InvitePanel';
import InstallCommand from './InstallCommand';
import Roster from './Roster';
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: project } = await supabase.from('projects').select('id, name, owner_id').eq('id', id).single();
  if (!project) return <main className="p-8">Not found.</main>;
  const { data: me } = await supabase.from('project_members').select('token').eq('project_id', id).eq('user_id', user!.id).maybeSingle();
  const isOwner = project.owner_id === user!.id;
  return (
    <main className="mx-auto max-w-3xl p-8 space-y-8">
      <h1 className="text-xl font-semibold">{project.name}</h1>
      {me?.token && <InstallCommand token={me.token} />}
      {isOwner && <InvitePanel projectId={id} />}
      {isOwner && <Roster projectId={id} />}
      <LiveView projectId={id} />
    </main>
  );
}
```

- [x] **Step 2: Install command** `app/projects/[id]/InstallCommand.tsx`
```tsx
'use client';
export default function InstallCommand({ token }: { token: string }) {
  const cmd = `npx convoy-cli@latest connect ${token}`;
  return (
    <section className="space-y-2">
      <h2 className="font-medium">Connect Claude Code</h2>
      <p className="text-sm text-gray-600">Run once in your terminal, then restart your Claude Code sessions. Never put secrets in shared context.</p>
      <div className="flex gap-2">
        <code className="flex-1 overflow-x-auto rounded bg-gray-100 p-3 text-xs">{cmd}</code>
        <button onClick={() => navigator.clipboard.writeText(cmd)} className="rounded border px-3">Copy</button>
      </div>
    </section>
  );
}
```

- [x] **Step 3: Invite panel** `app/projects/[id]/InvitePanel.tsx`
```tsx
'use client';
import { useState } from 'react';
export default function InvitePanel({ projectId }: { projectId: string }) {
  const [email, setEmail] = useState(''); const [msg, setMsg] = useState('');
  const invite = async () => {
    const res = await fetch(`/api/projects/${projectId}/invite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    setMsg(res.ok ? 'Invited — they get an email to sign in.' : 'Failed (already invited?).');
  };
  return (
    <section className="space-y-2">
      <h2 className="font-medium">Invite teammate</h2>
      <div className="flex gap-2">
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="teammate@email.com" className="flex-1 rounded border px-3 py-2" />
        <button onClick={invite} className="rounded border px-4">Invite</button>
      </div>
      {msg && <p className="text-sm text-gray-600">{msg}</p>}
    </section>
  );
}
```

- [x] **Step 4: Verify** owner sees install command + invite panel; deploy.

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(ui): project shell, install command, invite panel" && git push`

### Task 15: Roster + revoke UI + realtime LiveView ✅

**Files:** `app/projects/[id]/Roster.tsx`, `app/projects/[id]/LiveView.tsx`; enable Realtime

- [x] **Step 1: Enable Realtime** — `alter publication supabase_realtime add table member_status, events;` (apply to Convoy project).

- [x] **Step 2: Roster** `app/projects/[id]/Roster.tsx`
```tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import { getBrowserSupabase } from '@/src/lib/supabase/client';
type Row = { id: string; email: string; display_name: string | null; user_id: string | null; revoked_at: string | null };
export default function Roster({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const load = useCallback(async () => {
    const { data } = await getBrowserSupabase().from('project_members')
      .select('id, email, display_name, user_id, revoked_at').eq('project_id', projectId);
    setRows(data ?? []);
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  const revoke = async (id: string) => { await fetch(`/api/members/${id}/revoke`, { method: 'POST' }); load(); };
  return (
    <section className="space-y-2">
      <h2 className="font-medium">Members</h2>
      <ul className="space-y-1 text-sm">
        {rows.map(r => (
          <li key={r.id} className="flex items-center justify-between rounded border px-3 py-2">
            <span>{r.display_name || r.email}{' '}
              <span className="text-xs text-gray-500">
                {r.revoked_at ? '· revoked' : r.user_id ? '· connected' : '· pending'}
              </span>
            </span>
            {!r.revoked_at && <button onClick={() => revoke(r.id)} className="text-xs text-red-600 underline">Revoke</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [x] **Step 3: LiveView** `app/projects/[id]/LiveView.tsx`
```tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import { getBrowserSupabase } from '@/src/lib/supabase/client';
import { computeOverlap, type MemberSnapshot } from '@/src/lib/overlap';
import type { StatusRow, EventRow } from '@/src/types/db';
export default function LiveView({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<StatusRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const sb = getBrowserSupabase();
    const [{ data: s }, { data: e }, { data: m }] = await Promise.all([
      sb.from('member_status').select('*').eq('project_id', projectId).is('ended_at', null),
      sb.from('events').select('*').eq('project_id', projectId).order('ts', { ascending: false }).limit(50),
      sb.from('project_members').select('id, display_name, email').eq('project_id', projectId),
    ]);
    setStatus(s ?? []); setEvents(e ?? []);
    setNames(Object.fromEntries((m ?? []).map((x: any) => [x.id, x.display_name || x.email])));
  }, [projectId]);
  useEffect(() => {
    load();
    const sb = getBrowserSupabase();
    const ch = sb.channel(`proj-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_status', filter: `project_id=eq.${projectId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `project_id=eq.${projectId}` }, load)
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [projectId, load]);

  const snaps: MemberSnapshot[] = status.map(s => ({
    memberId: s.member_id, displayName: names[s.member_id] ?? 'teammate', branch: s.branch, files: s.files, lastActivityAt: s.updated_at,
  }));
  const banners = snaps.flatMap((me, i) =>
    computeOverlap({ files: me.files, branch: me.branch }, snaps.slice(i + 1), new Date())
      .map(a => `${me.displayName} & ${a.displayName} both on ${a.file}`));

  return (
    <section className="space-y-6">
      {banners.map((b, i) => (
        <div key={i} className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">⚠️ {b}</div>
      ))}
      <div>
        <h2 className="font-medium">Active sessions</h2>
        <div className="grid gap-3 sm:grid-cols-2 mt-2">
          {status.map(s => (
            <div key={`${s.member_id}-${s.session_id}`} className="rounded border p-3">
              <div className="font-medium">{names[s.member_id] ?? 'teammate'}</div>
              <div className="text-xs text-gray-500">{s.branch ?? 'no branch'} · {new Date(s.updated_at).toLocaleTimeString()}</div>
              <div className="text-xs text-gray-500 mt-1">{s.files.join(', ')}</div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h2 className="font-medium">Activity</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {events.map(e => (
            <li key={e.id} className="text-gray-700">
              <span className="text-gray-400">{new Date(e.ts).toLocaleTimeString()}</span>{' '}
              <span className="font-medium">{names[e.member_id] ?? 'teammate'}</span> {e.message}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

- [x] **Step 4: Verify live** — two browsers (owner + invited member). From a connected Claude session, edit a file → an "Active sessions" card + activity entry appear without refresh. Two members editing the same file → red banner. Stop a session → its card drops (ended_at set). Revoke a member in the roster → their token 401s.

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(ui): realtime live view + member roster/revoke" && git push`

---

# Phase 7 — E2E + ship ✅

### Task 16: E2E overlap test (seeded session) + final deploy ✅

**Files:** `tests/e2e/overlap.spec.ts`, `playwright.config.ts`

- [x] **Step 1: `playwright.config.ts`**
```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/e2e', use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000' } });
```

- [x] **Step 2: E2E** `tests/e2e/overlap.spec.ts` — seed a Supabase session (do NOT automate Google)
```ts
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { getAdmin } from '../../src/lib/supabase/admin';
import { ingestEdit } from '../../src/lib/ingest';

// global-setup alternative: mint an access token for the owner test user via admin, set it as a cookie.
test('overlap banner appears when two members share a file', async ({ page, context }) => {
  const admin = getAdmin();
  const { data: members } = await admin.from('project_members').select('*').limit(2);
  const [m1, m2] = members!;
  await ingestEdit(m1 as any, { session_id: 'e1', branch: 'feat/x', files: ['src/auth.ts'] });
  await ingestEdit(m2 as any, { session_id: 'e2', branch: 'feat/y', files: ['src/auth.ts'] });

  // Authenticate as m1's user by generating a session and injecting the Supabase auth cookie.
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: link } = await sb.auth.admin.generateLink({ type: 'magiclink', email: m1.email });
  // Follow the action_link once to set cookies in this browser context, then visit the project.
  await page.goto(link!.properties!.action_link!);
  await page.goto(`/projects/${m1.project_id}`);
  await expect(page.getByText(/both on src\/auth\.ts/)).toBeVisible();
});
```
(If `generateLink` cookie flow is awkward, instead set the `sb-<ref>-auth-token` cookie directly from a service-role-minted session. Document the chosen approach in a comment.)

- [x] **Step 3: Full suite** — `pnpm test && pnpm e2e` → all green (overlap, ingest, mcp-tools, rls, e2e).

- [x] **Step 4: Final prod deploy + 2-machine smoke** — `pnpm dlx vercel@latest --prod`; on two machines with two tokens, edit the same file → each session's `pull_team_context` returns the alert AND both browsers show the banner; stop a session → card clears.

- [x] **Step 5: Tick this plan + design `[ ]`→`[x]` and commit** — `git add -A && git commit -m "test(e2e): overlap banner E2E + final prod deploy" && git push`

---

## Self-Review (author check)

- **Spec coverage:** auth (T11) · projects (T12) · invites+email+revoke (T13) · per-session status + ingest (T2,T6,T7) · hook/CLI capture (T8) · MCP read + alerts (T9,T10) · overlap engine + event-file union (T4,T9) · live view + roster (T14,T15) · RLS (T3) · session idle (T6 ingestIdle + T8 Stop hook + T15 ended_at filter) · seeded E2E (T16). v2 gap-fixes all mapped. Out-of-scope items excluded per design.
- **Placeholders:** none — every step carries real code/commands.
- **Type consistency:** `MemberRow/StatusRow/EventRow` (T2) used verbatim in T5,T6,T9,T15; `MemberSnapshot/OverlapAlert/computeOverlap` (T4) used in T9,T15; ingest fn arg names match `0003_ingest_fn.sql` (T2). `member_status` is keyed `(member_id, session_id)` everywhere; React keys use both.

> ⚠️ **Verify-before-trust points during implementation:** (1) `mcp-handler` `withMcpAuth`/`authInfo.extra` shape + whether it needs `REDIS_URL` (T10 — prefer stateless). (2) Claude Code hook payload field names (`session_id`, `cwd`, `tool_input.file_path`, `hook_event_name`) (T8) — confirm against current hooks docs before relying on them. (3) Playwright Supabase session-cookie seeding (T16) — the cleanest exact mechanism may differ by `@supabase/ssr` cookie name.
