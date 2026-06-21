import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
const URL = process.env.LOCAL_SUPABASE_URL!, ANON = process.env.LOCAL_SUPABASE_ANON!;
async function asUser(email: string) {
  const c = createClient(URL, ANON);
  await c.auth.signInWithPassword({ email, password: 'test-pass-123' });
  return c;
}
// Behavioral two-user isolation test runs only against a local `supabase start` stack
// (set LOCAL_SUPABASE_URL + LOCAL_SUPABASE_ANON). On cloud, RLS is verified via the Supabase advisor.
describe.skipIf(!process.env.LOCAL_SUPABASE_URL)('RLS', () => {
  it('a user cannot read another user\'s project', async () => {
    const a = await asUser('a@test.dev');
    const { data: created } = await a.from('projects').insert({ name: 'A proj' }).select().single();
    const b = await asUser('b@test.dev');
    const { data: seen } = await b.from('projects').select('*').eq('id', created!.id);
    expect(seen).toHaveLength(0);
  });
});
