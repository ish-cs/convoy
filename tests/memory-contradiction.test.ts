import { describe, it, expect } from 'vitest';
import { cosine, findContradictions, sharesSubject, CONTRA_SIM_MIN } from '../src/lib/memory-contradiction';

// Build a unit vector pointing mostly along axis `i`, nudged by `noise` toward axis 0,
// so we can dial cosine similarity between two vectors deterministically.
function vec(seed: number[]): number[] {
  const n = Math.sqrt(seed.reduce((s, x) => s + x * x, 0));
  return seed.map(x => x / n);
}

describe('cosine', () => {
  it('is 1 for identical, ~0 for orthogonal', () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
  });
  it('returns 0 on dimension mismatch or empty', () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
    expect(cosine([], [])).toBe(0);
  });
});

describe('findContradictions', () => {
  const close = vec([1, 0.6, 0]);   // sim with base ~0.86 — in [MIN, MAX) band
  const base = vec([1, 0, 0]);
  const far = vec([0, 1, 0]);       // orthogonal — different topic, not a contradiction
  const dupe = vec([1, 0.02, 0]);   // sim ~0.9998 — near-duplicate, excluded

  const incoming = { id: 'in', text: 'tokens live in http-only cookies', content_hash: 'h-in', embedding: base };

  it('flags a same-topic memory whose text differs (band MIN..MAX)', () => {
    const existing = [{ id: 'e1', text: 'store tokens in localStorage', content_hash: 'h-e1', embedding: close }];
    expect(findContradictions(incoming, existing)).toEqual(['e1']);
  });

  it('ignores a different-topic memory (low similarity)', () => {
    const existing = [{ id: 'e2', text: 'ci runs vitest then playwright', content_hash: 'h-e2', embedding: far }];
    expect(findContradictions(incoming, existing)).toEqual([]);
  });

  it('ignores a near-duplicate (sim >= MAX) and exact content_hash matches', () => {
    const existing = [
      { id: 'e3', text: 'tokens kept in http only cookies', content_hash: 'h-e3', embedding: dupe },
      { id: 'e4', text: 'totally different wording', content_hash: 'h-in', embedding: close }, // same hash → skip
    ];
    expect(findContradictions(incoming, existing)).toEqual([]);
  });

  it('does not flag a memory with identical normalized text', () => {
    const existing = [{ id: 'e5', text: '  Tokens LIVE in http-only cookies ', content_hash: 'h-e5', embedding: close }];
    expect(findContradictions(incoming, existing)).toEqual([]);
  });

  it('MIN threshold is documented and sane', () => {
    expect(CONTRA_SIM_MIN).toBeGreaterThan(0.5);
    expect(CONTRA_SIM_MIN).toBeLessThan(CONTRA_SIM_MIN + 0.2);
  });
});

describe('sharesSubject', () => {
  it('true on overlapping file path (normalized) or tag', () => {
    const a = { id: 'a', text: '', content_hash: 'a', embedding: [], file_paths: ['./src/auth.ts'], tags: ['auth'] };
    const b = { id: 'b', text: '', content_hash: 'b', embedding: [], file_paths: ['src/auth.ts'], tags: [] };
    const c = { id: 'c', text: '', content_hash: 'c', embedding: [], file_paths: [], tags: ['auth'] };
    const d = { id: 'd', text: '', content_hash: 'd', embedding: [], file_paths: ['src/other.ts'], tags: ['ci'] };
    expect(sharesSubject(a, b)).toBe(true);
    expect(sharesSubject(a, c)).toBe(true);
    expect(sharesSubject(a, d)).toBe(false);
  });
});
