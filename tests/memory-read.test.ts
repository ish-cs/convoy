import { describe, it, expect, vi, afterEach } from 'vitest';
import { recallMemory } from '../src/lib/memory-read';
import { __setEmbedder } from '../src/lib/embed';

afterEach(() => __setEmbedder(null));

describe('recallMemory', () => {
  it('embeds the query and fuses recall_memory_hybrid candidates via the ranker', async () => {
    __setEmbedder(async () => new Array(384).fill(0.01));
    const db = { rpc: vi.fn().mockResolvedValue({ data: [
      { id: 'm1', file_paths: [], created_at: '2026-06-21T00:00:00Z', confidence: 1, fts_rank: 0.9, semantic_sim: 0.8 },
    ], error: null }) } as any;
    const rows = await recallMemory(db, { query: 'cookies', projectId: 'p' });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('m1');
    expect(db.rpc).toHaveBeenCalledWith('recall_memory_hybrid', expect.objectContaining({ p: 'p', q: 'cookies' }));
    expect(db.rpc.mock.calls[0][1].qe).toHaveLength(384);
  });

  it('returns [] on rpc error (additive, never throws)', async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }) } as any;
    expect(await recallMemory(db, { query: '', projectId: 'p' })).toEqual([]);
  });

  it('degrades to FTS-only (qe null) when query embedding fails', async () => {
    __setEmbedder(async () => { throw new Error('quota'); });
    const db = { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) } as any;
    await recallMemory(db, { query: 'cookies', projectId: 'p' });
    expect(db.rpc.mock.calls[0][1].qe).toBeNull();
  });
});
