import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { embed } from '../src/lib/embed';
import { recallMemory } from '../src/lib/memory-read';

// Integration: semantic recall. A query that shares almost NO words with the relevant memory
// must still surface it ahead of a lexically-irrelevant one — proving the embedding/cosine
// path (not just FTS) is live end-to-end against the real DB + Gemini.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const stamp = Date.now();
const email = `rank-int-${stamp}@convoy.test`;
let userId: string, projectId: string, memberId: string;

const SECURITY = 'store session tokens in http-only cookies so client scripts cannot read them';
const CI = 'the build pipeline runs vitest then playwright on every push to main';

async function seed(text: string): Promise<void> {
  const { data } = await admin.from('memory').insert({
    project_id: projectId, author_member_id: memberId, author_kind: 'human', source_tool: 'web',
    text, file_paths: [], content_hash: `rank-${stamp}-${text.slice(0, 8)}`,
  }).select('id').single();
  const vec = await embed(text);
  await admin.from('memory').update({ embedding: JSON.stringify(vec) }).eq('id', data!.id);
}

beforeAll(async () => {
  userId = (await admin.auth.admin.createUser({ email, email_confirm: true })).data.user!.id;
  projectId = (await admin.from('projects').insert({ name: 'rank-int', owner_id: userId }).select().single()).data!.id;
  memberId = (await admin.from('project_members').insert({ project_id: projectId, user_id: userId, email }).select().single()).data!.id;
  await seed(SECURITY);
  await seed(CI);
}, 30_000);

afterAll(async () => {
  if (projectId) await admin.from('projects').delete().eq('id', projectId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe('semantic recall (hybrid ranker, live)', () => {
  it('surfaces the meaning-closest memory for a lexically-dissimilar query', async () => {
    // No shared content words with SECURITY ("credentials safe in the browser" vs
    // "http-only cookies session tokens") — FTS alone would not rank it; semantics must.
    const rows = await recallMemory(admin, { query: 'how do we keep auth credentials safe in the browser', projectId });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].text).toBe(SECURITY);
  }, 30_000);
});
