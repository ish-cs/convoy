import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { isActive } from '../src/lib/memory-core';
import { supersedeMemory, archiveMemory } from '../src/lib/memory-lifecycle';
import { insertMemory } from '../src/lib/memory-write';
import { recallMemory } from '../src/lib/memory-read';
import type { MemoryRow } from '../src/types/db';

const base = (o: Partial<MemoryRow>): MemoryRow => ({
  id: 'm', project_id: 'p', author_member_id: 'a', author_kind: 'human', source_tool: 'web',
  text: 't', file_paths: [], branch: null, tags: [], status: 'confirmed', confidence: 1,
  superseded_by: null, content_hash: 'h', contradicts: [], ref_count: 0, created_at: '2026-06-21T00:00:00Z',
  last_referenced_at: null, expires_at: null, archived_at: null, ...o });

describe('isActive', () => {
  it('hides superseded / archived / expired, keeps live', () => {
    const now = Date.parse('2026-06-21T12:00:00Z');
    expect(isActive(base({}), now)).toBe(true);
    expect(isActive(base({ superseded_by: 'x' }), now)).toBe(false);
    expect(isActive(base({ archived_at: '2026-06-21T01:00:00Z' }), now)).toBe(false);
    expect(isActive(base({ expires_at: '2000-01-01T00:00:00Z' }), now)).toBe(false);
  });
});

describe('archiveMemory', () => {
  it('updates archived_at scoped to id + project', async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const update = vi.fn((_row: { archived_at?: string }) => ({ eq: eq1 }));
    const db = { from: vi.fn(() => ({ update })) } as any;
    await archiveMemory(db, { id: 'm1', projectId: 'p1' });
    expect(update.mock.calls[0][0].archived_at).toBeTruthy();
    expect(eq1).toHaveBeenCalledWith('id', 'm1');
    expect(eq2).toHaveBeenCalledWith('project_id', 'p1');
  });
});

describe('supersede (cloud integration)', () => {
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(URL, SR, { auth: { persistSession: false } });
  let userId: string, projectId: string, memberId: string, oldId: string;

  beforeAll(async () => {
    const email = `lifecycle-${Date.now()}@convoy.test`;
    userId = (await admin.auth.admin.createUser({ email, email_confirm: true })).data.user!.id;
    projectId = (await admin.from('projects').insert({ name: 'lc', owner_id: userId }).select().single()).data!.id;
    memberId = (await admin.from('project_members').insert({ project_id: projectId, user_id: userId, email }).select().single()).data!.id;
    const r = await insertMemory(admin, { projectId, authorMemberId: memberId, authorKind: 'human', sourceTool: 'web', text: 'use 12-char salt for hashing', filePaths: ['src/crypto.ts'] });
    oldId = r.id;
  });
  afterAll(async () => {
    if (projectId) await admin.from('projects').delete().eq('id', projectId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it('supersede sets old.superseded_by and only the new memory is recalled', async () => {
    const { id: newId } = await supersedeMemory(admin, { oldId, projectId, authorMemberId: memberId, authorKind: 'human', sourceTool: 'web', text: 'use 16-char salt for hashing', filePaths: ['src/crypto.ts'] });
    const { data: old } = await admin.from('memory').select('superseded_by').eq('id', oldId).single();
    expect(old!.superseded_by).toBe(newId);
    const recalled = await recallMemory(admin, { query: 'salt hashing', projectId });
    const ids = recalled.map(m => m.id);
    expect(ids).toContain(newId);
    expect(ids).not.toContain(oldId);
  });
});
