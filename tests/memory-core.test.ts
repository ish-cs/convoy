import { describe, it, expect } from 'vitest';
import { contentHash, detectSecret, matchMemoriesForFiles } from '../src/lib/memory-core';
import type { MemoryRow } from '../src/types/db';
const mk = (o: Partial<MemoryRow>): MemoryRow => ({
  id: 'm', project_id: 'p', author_member_id: 'a', author_kind: 'human', source_tool: 'web',
  text: 't', file_paths: [], branch: null, tags: [], status: 'confirmed', confidence: 1,
  superseded_by: null, content_hash: 'h', contradicts: [], created_at: '2026-06-21T00:00:00Z',
  last_referenced_at: null, expires_at: null, archived_at: null, ...o });
describe('contentHash', () => {
  it('is order-insensitive on paths and stable', () => {
    expect(contentHash('x', ['b.ts','a.ts'])).toBe(contentHash('x', ['a.ts','b.ts']));
  });
});
describe('detectSecret', () => {
  it('flags an obvious api key', () => {
    expect(detectSecret('key sk-ABCDEF0123456789ABCDEF0123')).toMatch(/secret|key/i);
  });
  it('passes clean text', () => { expect(detectSecret('use http-only cookies')).toBeNull(); });
});
describe('matchMemoriesForFiles', () => {
  it('matches normalized path, excludes archived/superseded/expired', () => {
    const rows = [
      mk({ id: '1', file_paths: ['./src/auth.ts'] }),
      mk({ id: '2', file_paths: ['src/auth.ts'], archived_at: '2026-06-21T01:00:00Z' }),
      mk({ id: '3', file_paths: ['src/auth.ts'], superseded_by: 'x' }),
      mk({ id: '4', file_paths: ['src/auth.ts'], expires_at: '2000-01-01T00:00:00Z' }),
    ];
    expect(matchMemoriesForFiles(rows, ['src/auth.ts']).map(m => m.id)).toEqual(['1']);
  });
});
