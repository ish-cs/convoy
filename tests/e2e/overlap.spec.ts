import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// True production E2E of the wedge: two members edit the same file through the
// deployed /api/ingest, then pull_team_context over the hosted /mcp must return
// the overlap alert. Exercises auth, ingest RPC, retrieval, and the overlap engine
// across the real network — no mocks. Self-seeds and self-cleans.
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BASE = process.env.E2E_BASE_URL ?? 'https://convoy-ish-c.vercel.app';

test('overlap alert round-trips through prod ingest + MCP', async () => {
  const admin = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });
  const email = `e2e-${Date.now()}@convoy.test`;
  const { data: u, error: ue } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (ue || !u.user) throw new Error(`create user: ${ue?.message}`);
  const userId = u.user.id;
  const { data: proj, error: pe } = await admin.from('projects').insert({ name: 'E2E', owner_id: userId }).select().single();
  if (pe) throw new Error(`create project: ${pe.message}`);
  const mk = async (name: string) => {
    const { data, error } = await admin.from('project_members')
      .insert({ project_id: proj!.id, email: `${name}-${email}`, display_name: name }).select().single();
    if (error) throw new Error(`create member: ${error.message}`);
    return data!;
  };
  const m1 = await mk('A'); const m2 = await mk('B');

  const ingest = (token: string, files: string[]) => fetch(`${BASE}/api/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ session_id: `e2e-${token.slice(0, 6)}`, kind: 'edit', branch: 'feat/x', files }),
  });
  const mcpCall = async (token: string) => {
    const r = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pull_team_context', arguments: { branch: 'feat/x', files: ['src/auth.ts'] } } }),
    });
    const text = await r.text();
    const env = JSON.parse(text.replace(/^event: message\s*data: /, ''));
    return JSON.parse(env.result.content[0].text);
  };

  try {
    expect((await ingest(m1.token, ['src/auth.ts'])).status).toBe(200);
    expect((await ingest(m2.token, ['src/auth.ts'])).status).toBe(200);
    const payload = await mcpCall(m1.token);
    const alert = (payload.alerts ?? []).find((a: { file: string; memberId: string }) => a.file === 'src/auth.ts' && a.memberId === m2.id);
    expect(alert, 'pull_team_context should surface an overlap alert for the partner on src/auth.ts').toBeTruthy();
  } finally {
    await admin.from('projects').delete().eq('id', proj!.id);
    await admin.auth.admin.deleteUser(userId);
  }
});
