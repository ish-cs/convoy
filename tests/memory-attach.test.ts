import { describe, it, expect } from 'vitest';
import { attachMemory } from '../src/lib/memory-core';
import type { OverlapAlert } from '../src/lib/overlap';
import type { MemoryRow } from '../src/types/db';

const mem = (id: string, file: string): MemoryRow => ({
  id, project_id: 'p', author_member_id: 'a', author_kind: 'human', source_tool: 'web',
  text: 't'+id, file_paths: [file], branch: null, tags: [], status: 'confirmed', confidence: 1,
  superseded_by: null, content_hash: 'h'+id, contradicts: [], created_at: '2026-06-21T00:00:0'+id+'Z',
  last_referenced_at: null, expires_at: null, archived_at: null });
const alert = (file: string): OverlapAlert => ({ memberId: 'x', displayName: 'X', branch: null, file, lastActivityAt: '2026-06-21T00:00:00Z' });

describe('attachMemory', () => {
  it('attaches matching memories capped at 3', () => {
    const memories = [mem('1','src/auth.ts'), mem('2','src/auth.ts'), mem('3','src/auth.ts'), mem('4','src/auth.ts')];
    const out = attachMemory([alert('src/auth.ts')], memories);
    expect(out[0].memory).toHaveLength(3);
  });
  it('no match → empty memory list, alert still present', () => {
    const out = attachMemory([alert('src/auth.ts')], [mem('1','src/other.ts')]);
    expect(out[0].memory).toEqual([]);
    expect(out[0].file).toBe('src/auth.ts');
  });
});
