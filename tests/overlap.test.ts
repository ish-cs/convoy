import { describe, it, expect } from 'vitest';
import { computeOverlap, normalizePath } from '../src/lib/overlap';
const NOW = new Date('2026-06-21T12:00:00Z');
const iso = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const other = (files: string[], minsAgo: number) =>
  ({ memberId: 'm2', displayName: 'Partner', branch: 'feat/y', files, lastActivityAt: iso(minsAgo) });

describe('normalizePath', () => {
  it('strips ./ and collapses slashes', () => {
    expect(normalizePath('./src//a.ts')).toBe('src/a.ts');
    expect(normalizePath('  src/a.ts ')).toBe('src/a.ts');
  });
});
describe('computeOverlap', () => {
  it('flags a shared file within the window', () => {
    const a = computeOverlap({ files: ['src/auth.ts'], branch: 'feat/x' }, [other(['src/auth.ts'], 4)], NOW);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ displayName: 'Partner', file: 'src/auth.ts', branch: 'feat/y' });
  });
  it('ignores activity older than the window', () => {
    expect(computeOverlap({ files: ['src/auth.ts'], branch: 'feat/x' }, [other(['src/auth.ts'], 61)], NOW)).toHaveLength(0);
  });
  it('ignores non-overlapping files', () => {
    expect(computeOverlap({ files: ['src/a.ts'], branch: 'feat/x' }, [other(['src/b.ts'], 1)], NOW)).toHaveLength(0);
  });
  it('normalizes paths before comparing', () => {
    expect(computeOverlap({ files: ['./src/auth.ts'], branch: 'feat/x' }, [other(['src//auth.ts'], 1)], NOW)).toHaveLength(1);
  });
  it('one alert per overlapping file across members', () => {
    const a = computeOverlap({ files: ['a.ts','b.ts'], branch: 'feat/x' },
      [other(['a.ts'],1), { ...other(['b.ts'],1), memberId:'m3', displayName:'Cee' }], NOW);
    expect(a.map(x => x.file).sort()).toEqual(['a.ts','b.ts']);
  });
  it('empty inputs → no alerts', () => {
    expect(computeOverlap({ files: [], branch: null }, [], NOW)).toEqual([]);
  });
});
