import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// Behavioral RLS isolation test against the REAL cloud project (not the local-only
// rls.test.ts). Two genuinely separate authenticated users: B must not be able to
// read A's project, members, status, or events. This proves the policies actually
// enforce isolation — the advisor only checks that RLS is enabled, not that it's correct.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const PW = 'rls-test-pass-123456';

let aId: string, bId: string, projectA: string, memberA: string;
const stamp = Date.now();
const emailA = `rls-a-${stamp}@convoy.test`;
const emailB = `rls-b-${stamp}@convoy.test`;

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
  const { data: proj, error: pe } = await admin.from('projects').insert({ name: 'A-private', owner_id: aId }).select().single();
  if (pe) throw new Error(`project: ${pe.message}`);
  projectA = proj!.id;
  const { data: m, error: me } = await admin.from('project_members').insert({ project_id: projectA, user_id: aId, email: emailA }).select().single();
  if (me) throw new Error(`member: ${me.message}`);
  memberA = m!.id;
  // seed a status row + event so there is something B could leak if RLS were wrong
  await admin.rpc('ingest_edit', { p_member: memberA, p_session: 'rls-s', p_project: projectA, p_branch: 'main', p_files: ['secret.ts'], p_message: 'edited secret.ts' });
});

afterAll(async () => {
  if (projectA) await admin.from('projects').delete().eq('id', projectA);
  if (aId) await admin.auth.admin.deleteUser(aId);
  if (bId) await admin.auth.admin.deleteUser(bId);
});

describe('RLS isolation (cloud)', () => {
  it('owner A can read their own project', async () => {
    const a = await signIn(emailA);
    const { data } = await a.from('projects').select('*').eq('id', projectA);
    expect(data).toHaveLength(1);
  });

  it('outsider B cannot read A\'s project', async () => {
    const b = await signIn(emailB);
    const { data } = await b.from('projects').select('*').eq('id', projectA);
    expect(data).toHaveLength(0);
  });

  it('outsider B cannot read A\'s members', async () => {
    const b = await signIn(emailB);
    const { data } = await b.from('project_members').select('*').eq('project_id', projectA);
    expect(data).toHaveLength(0);
  });

  it('outsider B cannot read A\'s member_status', async () => {
    const b = await signIn(emailB);
    const { data } = await b.from('member_status').select('*').eq('project_id', projectA);
    expect(data).toHaveLength(0);
  });

  it('outsider B cannot read A\'s events', async () => {
    const b = await signIn(emailB);
    const { data } = await b.from('events').select('*').eq('project_id', projectA);
    expect(data).toHaveLength(0);
  });
});
