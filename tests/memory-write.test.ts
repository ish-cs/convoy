import { describe, it, expect, vi } from 'vitest';
import { insertMemory } from '../src/lib/memory-write';

// Chainable query-builder mock: supports the dedup .select().eq().eq().is().maybeSingle()
// check and the .insert().select().single() write.
const db = (existing: { id: string } | null = null, inserted = { id: 'm1' }) => {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null });
  builder.insert = vi.fn(() => builder);
  builder.single = vi.fn().mockResolvedValue({ data: inserted, error: null });
  return { from: vi.fn(() => builder), _b: builder } as any;
};

describe('insertMemory', () => {
  it('rejects empty text', async () => {
    await expect(insertMemory(db(), { projectId:'p', authorMemberId:'a', authorKind:'agent', sourceTool:'claude-code', text:'  ' }))
      .rejects.toThrow('memory text required');
  });
  it('rejects secrets', async () => {
    await expect(insertMemory(db(), { projectId:'p', authorMemberId:'a', authorKind:'agent', sourceTool:'claude-code', text:'token ghp_012345678901234567890123456789012345' }))
      .rejects.toThrow(/secret|token|key/i);
  });
  it('inserts with explicit project scope, normalized paths, and content_hash', async () => {
    const d = db();
    const res = await insertMemory(d, { projectId:'p', authorMemberId:'a', authorKind:'human', sourceTool:'web', text:'use cookies', filePaths:['./src/auth.ts'], tags:['auth'] });
    expect(res).toEqual({ id: 'm1', deduped: false });
    const arg = d._b.insert.mock.calls[0][0];
    expect(arg.project_id).toBe('p');
    expect(arg.file_paths).toEqual(['src/auth.ts']);
    expect(typeof arg.content_hash).toBe('string');
    // Write path must NEVER compute/await an embedding — it's filled async by the backfill.
    expect(arg.embedding).toBeUndefined();
  });
  it('returns the existing id (deduped) when an active row already matches', async () => {
    const d = db({ id: 'existing-1' });
    const res = await insertMemory(d, { projectId:'p', authorMemberId:'a', authorKind:'agent', sourceTool:'web', text:'dup' });
    expect(res).toEqual({ id: 'existing-1', deduped: true });
    expect(d._b.insert).not.toHaveBeenCalled();
  });
});
