import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { insertMemory } from '../../src/lib/memory-write';
import { supersedeMemory } from '../../src/lib/memory-lifecycle';

// E2E: a pinned memory auto-attaches to an overlap alert via the hosted /mcp, and
// after supersede only the new memory shows. Exercises write → attach → lifecycle
// across the real network. Self-seeds + self-cleans.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BASE = process.env.E2E_BASE_URL ?? 'https://convoy-ish-c.vercel.app';

test('memory attaches to overlap alert and respects supersede', async () => {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const email = `e2e-mem-${Date.now()}@convoy.test`;
  const userId = (await admin.auth.admin.createUser({ email, email_confirm: true })).data.user!.id;
  const projectId = (await admin.from('projects').insert({ name: 'E2E-mem', owner_id: userId }).select().single()).data!.id;
  const mk = async (n: string) => (await admin.from('project_members').insert({ project_id: projectId, email: `${n}-${email}`, display_name: n }).select().single()).data!;
  const A = await mk('A'); const B = await mk('B');
  const memberA = (await admin.from('project_members').select('id').eq('id', A.id).single()).data!;

  const ingest = (token: string) => fetch(`${BASE}/api/ingest`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ session_id: `e2e-${token.slice(0, 6)}`, kind: 'edit', branch: 'feat/x', files: ['src/auth.ts'] }),
  });
  const pullAlertMemory = async (): Promise<string[]> => {
    const r = await fetch(`${BASE}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${A.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pull_team_context', arguments: { branch: 'feat/x', files: ['src/auth.ts'] } } }),
    });
    const env = JSON.parse((await r.text()).replace(/^event: message\s*data: /, ''));
    const payload = JSON.parse(env.result.content[0].text);
    return (payload.alerts[0]?.memory ?? []).map((m: { text: string }) => m.text);
  };

  try {
    const old = await insertMemory(admin, { projectId, authorMemberId: memberA.id, authorKind: 'human', sourceTool: 'web', text: 'v1: use a 12-char salt', filePaths: ['src/auth.ts'] });
    expect((await ingest(A.token)).status).toBe(200);
    expect((await ingest(B.token)).status).toBe(200);

    const before = await pullAlertMemory();
    expect(before.join(' ')).toContain('12-char salt');

    await supersedeMemory(admin, { oldId: old.id, projectId, authorMemberId: memberA.id, authorKind: 'human', sourceTool: 'web', text: 'v2: use a 16-char salt', filePaths: ['src/auth.ts'] });
    const after = await pullAlertMemory();
    expect(after.join(' ')).toContain('16-char salt');
    expect(after.join(' ')).not.toContain('12-char salt');
  } finally {
    await admin.from('projects').delete().eq('id', projectId);
    await admin.auth.admin.deleteUser(userId);
  }
});
