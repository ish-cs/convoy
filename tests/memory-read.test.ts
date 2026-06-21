import { describe, it, expect, vi } from 'vitest';
import { recallMemory } from '../src/lib/memory-read';

describe('recallMemory', () => {
  it('returns rows from recall_memory rpc', async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: [{ id: 'm1' }], error: null }) } as any;
    const rows = await recallMemory(db, { query: 'cookies', projectId: 'p' });
    expect(rows).toHaveLength(1);
    expect(db.rpc).toHaveBeenCalledWith('recall_memory', { p: 'p', q: 'cookies' });
  });
  it('returns [] on error (additive, never throws)', async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }) } as any;
    expect(await recallMemory(db, { query: '', projectId: 'p' })).toEqual([]);
  });
});
