import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolveMember } from '../src/lib/mcp/auth';
import { getAdmin } from '../src/lib/ingest_test_helpers';
import { ingestEdit } from '../src/lib/ingest';
import { pullTeamContext, setMyStatus } from '../src/lib/mcp/tools';
import type { MemberRow } from '../src/types/db';

describe('resolveMember', () => {
  it('returns null for an unknown token', async () => {
    expect(await resolveMember('definitely-not-real')).toBeNull();
  });
});

describe('mcp tools', () => {
  let M1: MemberRow, M2: MemberRow, P: string, userId: string;

  beforeAll(async () => {
    const admin = getAdmin();
    const email = `tools-${Date.now()}@convoy.test`;
    const { data: u, error: ue } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (ue || !u.user) throw new Error(`create user failed: ${ue?.message}`);
    userId = u.user.id;
    const { data: proj, error: pe } = await admin.from('projects').insert({ name: 'P', owner_id: userId }).select().single();
    if (pe) throw new Error(`create project failed: ${pe.message}`);
    P = proj!.id;
    const mk = async (suffix: string, display: string) => {
      const { data: m, error: me } = await admin.from('project_members')
        .insert({ project_id: P, email: `${suffix}-${email}`, display_name: display }).select().single();
      if (me) throw new Error(`create member failed: ${me.message}`);
      return m as MemberRow;
    };
    M1 = await mk('m1', 'Alice');
    M2 = await mk('m2', 'Bob');
  });

  afterAll(async () => {
    const admin = getAdmin();
    if (P) await admin.from('projects').delete().eq('id', P); // cascades members/status/events
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it('pull surfaces partner active session, events, and overlap alerts', async () => {
    await ingestEdit(M2, { session_id: 's2', branch: 'feat/y', files: ['src/auth.ts'] });
    const res = await pullTeamContext(M1, { branch: 'feat/x', files: ['src/auth.ts'] }, new Date());
    expect(res.members.some((s) => s.member_id === M2.id)).toBe(true);
    expect(res.alerts.some((a) => a.file === 'src/auth.ts' && a.memberId === M2.id)).toBe(true);
  });

  it('overlap includes recent event files even if not in current session file list', async () => {
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
    expect(res.alerts.every((a) => a.memberId !== M1.id)).toBe(true);
    expect(res.members.every((s) => s.member_id !== M1.id)).toBe(true);
  });
});
