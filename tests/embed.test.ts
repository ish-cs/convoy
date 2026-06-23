import { describe, it, expect, afterEach } from 'vitest';
import { embed, EMBED_DIM, __setEmbedder } from '../src/lib/embed';

afterEach(() => __setEmbedder(null));

describe('embed seam', () => {
  it('EMBED_DIM is 384 (matches the memory.embedding vector(384) column)', () => {
    expect(EMBED_DIM).toBe(384);
  });

  it('returns EMBED_DIM numbers via the injected embedder', async () => {
    __setEmbedder(async () => new Array(384).fill(0.1));
    const v = await embed('use http-only cookies for auth');
    expect(v).toHaveLength(384);
    expect(typeof v[0]).toBe('number');
  });

  it('rejects an embedding whose dimension != EMBED_DIM (the verify-before-trust guard)', async () => {
    __setEmbedder(async () => [0.1, 0.2, 0.3]);
    await expect(embed('x')).rejects.toThrow(/dim/i);
  });

  it('rejects empty text without ever calling the provider', async () => {
    let called = false;
    __setEmbedder(async () => { called = true; return new Array(384).fill(0); });
    await expect(embed('   ')).rejects.toThrow(/empty/i);
    expect(called).toBe(false);
  });
});
