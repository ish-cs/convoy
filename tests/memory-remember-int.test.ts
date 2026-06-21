import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { remember } from '../src/lib/mcp/tools';
import type { MemberRow } from '../src/types/db';

// Integration: the token-resolved remember() (admin path, no auth.uid) creates a row
// scoped to the caller's project, and an outsider's authed client cannot read it.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const PW = 'remember-int-123456';
const stamp = Date.now();
const emailA = `rem-a-${stamp}@convoy.test`;
const emailB = `rem-b-${stamp}@convoy.test`;
let aId: string, bId: string, projectA: string, memberA: MemberRow, createdId: string;

beforeAll(async () => {
  const mk = async (email: string) => (await admin.auth.admin.createUser({ email, password: PW, email_confirm: true })).data.user!.id;
  aId = await mk(emailA); bId = await mk(emailB);
  const { data: proj } = await admin.from('projects').insert({ name: 'rem-A', owner_id: aId }).select().single();
  projectA = proj!.id;
  const { data: m } = await admin.from('project_members').insert({ project_id: projectA, user_id: aId, email: emailA }).select().single();
  memberA = m as MemberRow;
});
afterAll(async () => {
  if (projectA) await admin.from('projects').delete().eq('id', projectA);
  if (aId) await admin.auth.admin.deleteUser(aId);
  if (bId) await admin.auth.admin.deleteUser(bId);
});

describe('remember() token-scoped write + isolation', () => {
  it('creates a row scoped to the caller project', async () => {
    const { id } = await remember(memberA, { text: 'prefer http-only cookies for auth', file_paths: ['src/auth.ts'], tags: ['auth'] });
    createdId = id;
    const { data } = await admin.from('memory').select('project_id, author_kind, file_paths').eq('id', id).single();
    expect(data!.project_id).toBe(projectA);
    expect(data!.author_kind).toBe('agent');
    expect(data!.file_paths).toEqual(['src/auth.ts']);
  });
  it('outsider B cannot read it', async () => {
    const b = createClient(URL, ANON, { auth: { persistSession: false } });
    await b.auth.signInWithPassword({ email: emailB, password: PW });
    const { data } = await b.from('memory').select('id').eq('id', createdId);
    expect(data).toHaveLength(0);
  });
});
