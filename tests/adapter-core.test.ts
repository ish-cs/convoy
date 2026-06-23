import { describe, it, expect } from 'vitest';
import { toRepoRelative, parsePorcelain, buildEditContract } from '../adapters/core.mjs';
import { parseContract } from '../src/lib/ingest-contract';

describe('adapter core — pure helpers', () => {
  it('toRepoRelative canonicalizes an absolute path under the repo root', () => {
    expect(toRepoRelative('/Users/x/proj/src/a.ts', '/Users/x/proj')).toBe('src/a.ts');
    expect(toRepoRelative('src/a.ts', '/Users/x/proj')).toBe('src/a.ts'); // already relative → idempotent
    expect(toRepoRelative('C:\\Users\\x\\proj\\src\\a.ts', 'C:/Users/x/proj')).toBe('src/a.ts');
  });

  it('parsePorcelain extracts repo-relative paths incl. renames, dedups', () => {
    const out = [' M src/a.ts', '?? new.ts', 'R  old.ts -> src/b.ts', ' M src/a.ts'].join('\n');
    expect(parsePorcelain(out).sort()).toEqual(['new.ts', 'src/a.ts', 'src/b.ts']);
  });

  it('parsePorcelain returns empty on a clean tree', () => {
    expect(parsePorcelain('')).toEqual([]);
  });

  it('buildEditContract produces a contract the v1 parser accepts as a non-Claude tool', () => {
    const c = buildEditContract({ sessionId: 'cursor-1', sourceTool: 'cursor', repo: 'acme/web', branch: 'feat/x', files: ['src/a.ts'] });
    expect(c.v).toBe(1);
    expect(c.source_tool).toBe('cursor');
    // The adapter's output MUST round-trip through the server's own contract parser.
    const r = parseContract(c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sourceTool).toBe('cursor');
    expect(r.value.files).toEqual(['src/a.ts']);
    expect(r.value.event).toEqual({ kind: 'edit', message: 'edited src/a.ts' });
  });

  it('every shipped adapter source_tool is accepted by the server contract', () => {
    for (const tool of ['cursor', 'copilot', 'codex']) {
      const c = buildEditContract({ sessionId: `${tool}-1`, sourceTool: tool, branch: null, files: ['x.ts'] });
      expect(parseContract(c).ok).toBe(true);
    }
  });
});
