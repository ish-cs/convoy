import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// Behavioral RLS for the memory table against the real cloud project: an outsider
// must never read another project's memory. Cloud test (not local-only) so it runs in CI.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const PW = 'mem-rls-pass-123456';

let aId: string, bId: string, projectA: string, memId: string;
const stamp = Date.now();
const emailA = `mem-a-${stamp}@convoy.test`;
const emailB = `mem-b-${stamp}@convoy.test`;

async function signIn(email: string) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return c;
}

beforeAll(async () => {
  const mk = async (email: string) => {
    const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
    return data.user.id;
  };
  aId = await mk(emailA);
  bId = await mk(emailB);
  const { data: proj, error: pe } = await admin.from('projects').insert({ name: 'mem-A', owner_id: aId }).select().single();
  if (pe) throw new Error(`project: ${pe.message}`);
  projectA = proj!.id;
  const { data: m, error: me } = await admin.from('project_members').insert({ project_id: projectA, user_id: aId, email: emailA }).select().single();
  if (me) throw new Error(`member: ${me.message}`);
  const { data: mem, error: xe } = await admin.from('memory').insert({
    project_id: projectA, author_member_id: m!.id, author_kind: 'human', source_tool: 'web',
    text: 'A private memory: prefer http-only cookies', file_paths: ['src/auth.ts'], content_hash: `h-${stamp}`,
  }).select().single();
  if (xe) throw new Error(`memory: ${xe.message}`);
  memId = mem!.id;
});

afterAll(async () => {
  if (projectA) await admin.from('projects').delete().eq('id', projectA);
  if (aId) await admin.auth.admin.deleteUser(aId);
  if (bId) await admin.auth.admin.deleteUser(bId);
});

describe('memory RLS isolation (cloud)', () => {
  it('owner A can read their own project memory', async () => {
    const a = await signIn(emailA);
    const { data } = await a.from('memory').select('id, text').eq('id', memId);
    expect(data).toHaveLength(1);
  });

  it('outsider B cannot read A\'s memory', async () => {
    const b = await signIn(emailB);
    const { data } = await b.from('memory').select('id').eq('project_id', projectA);
    expect(data).toHaveLength(0);
  });

  it('fts is populated by the trigger', async () => {
    const { data } = await admin.from('memory').select('fts').eq('id', memId).single();
    expect(data!.fts).toBeTruthy();
  });
});
