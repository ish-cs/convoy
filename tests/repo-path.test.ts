import { describe, it, expect } from 'vitest';
import { toRepoRelative } from '../src/lib/repo-path';
describe('toRepoRelative', () => {
  it('makes a macOS abs path repo-relative', () => {
    expect(toRepoRelative('/Users/alice/proj/src/auth.ts', '/Users/alice/proj')).toBe('src/auth.ts');
  });
  it('makes a Linux abs path under a different root match the same logical file', () => {
    expect(toRepoRelative('/home/bob/proj/src/auth.ts', '/home/bob/proj')).toBe('src/auth.ts');
  });
  it('normalizes Windows separators and drive root', () => {
    expect(toRepoRelative('C:\\Users\\bob\\proj\\src\\auth.ts', 'C:\\Users\\bob\\proj')).toBe('src/auth.ts');
  });
  it('is idempotent on already-relative input', () => {
    expect(toRepoRelative('src/auth.ts', '/whatever')).toBe('src/auth.ts');
  });
});
