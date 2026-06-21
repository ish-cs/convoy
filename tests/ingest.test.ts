import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getAdmin } from '../src/lib/ingest_test_helpers';
import { ingestEdit, ingestIdle } from '../src/lib/ingest';
import type { MemberRow } from '../src/types/db';

let M: MemberRow, P: string, userId: string;

beforeAll(async () => {
  const admin = getAdmin();
  const email = `ingest-${Date.now()}@convoy.test`;
  const { data: u, error: ue } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (ue || !u.user) throw new Error(`create user failed: ${ue?.message}`);
  userId = u.user.id;
  const { data: proj, error: pe } = await admin.from('projects').insert({ name: 'P', owner_id: userId }).select().single();
  if (pe) throw new Error(`create project failed: ${pe.message}`);
  P = proj!.id;
  const { data: m, error: me } = await admin.from('project_members').insert({ project_id: P, email }).select().single();
  if (me) throw new Error(`create member failed: ${me.message}`);
  M = m as MemberRow;
});

afterAll(async () => {
  const admin = getAdmin();
  if (P) await admin.from('projects').delete().eq('id', P); // cascades members/status/events
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe('ingest', () => {
  it('edit upserts a session row and unions files', async () => {
    await ingestEdit(M, { session_id: 's1', branch: 'feat/x', files: ['a.ts'] });
    await ingestEdit(M, { session_id: 's1', branch: 'feat/x', files: ['b.ts'] });
    const { data } = await getAdmin().from('member_status').select('*').eq('member_id', M.id).eq('session_id', 's1').single();
    expect(new Set(data!.files)).toEqual(new Set(['a.ts', 'b.ts']));
    const { data: ev } = await getAdmin().from('events').select('*').eq('member_id', M.id);
    expect(ev!.length).toBe(2);
  });
  it('idle sets ended_at', async () => {
    await ingestIdle(M, { session_id: 's1' });
    const { data } = await getAdmin().from('member_status').select('ended_at').eq('member_id', M.id).eq('session_id', 's1').single();
    expect(data!.ended_at).not.toBeNull();
  });
});
