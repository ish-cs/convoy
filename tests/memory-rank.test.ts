import { describe, it, expect } from 'vitest';
import { rankMemories, RANK_WEIGHTS, type RankCandidate } from '../src/lib/memory-rank';
import type { MemoryRow } from '../src/types/db';

const mk = (o: Partial<RankCandidate>): RankCandidate => ({
  id: 'm', project_id: 'p', author_member_id: 'a', author_kind: 'human', source_tool: 'web',
  text: 't', file_paths: [], branch: null, tags: [], status: 'confirmed', confidence: 1,
  superseded_by: null, content_hash: 'h', created_at: '2026-06-21T00:00:00Z',
  last_referenced_at: null, expires_at: null, archived_at: null, ...o,
} as MemoryRow & Partial<RankCandidate>);

const NOW = new Date('2026-06-21T12:00:00Z').getTime();

describe('rankMemories', () => {
  it('weights file higher in attach mode and semantic higher in recall mode', () => {
    expect(RANK_WEIGHTS.attach.file).toBeGreaterThan(RANK_WEIGHTS.recall.file);
    expect(RANK_WEIGHTS.recall.semantic).toBeGreaterThan(RANK_WEIGHTS.attach.semantic);
  });

  it('file-match dominates in attach mode (coordination-native)', () => {
    const fileMatch = mk({ id: 'file', file_paths: ['src/auth.ts'], semanticSim: 0.1, created_at: '2026-01-01T00:00:00Z' });
    const semantic = mk({ id: 'sem', file_paths: ['src/other.ts'], semanticSim: 0.95 });
    const out = rankMemories([semantic, fileMatch], { files: ['src/auth.ts'], now: NOW, mode: 'attach' });
    expect(out[0].id).toBe('file');
  });

  it('semantic dominates in recall mode', () => {
    const fileMatch = mk({ id: 'file', file_paths: ['src/auth.ts'], semanticSim: 0.1 });
    const semantic = mk({ id: 'sem', file_paths: ['src/other.ts'], semanticSim: 0.95 });
    const out = rankMemories([fileMatch, semantic], { files: ['src/auth.ts'], now: NOW, mode: 'recall' });
    expect(out[0].id).toBe('sem');
  });

  it('newer ranks above older when all else equal', () => {
    const old = mk({ id: 'old', created_at: '2026-01-01T00:00:00Z' });
    const fresh = mk({ id: 'fresh', created_at: '2026-06-21T00:00:00Z' });
    const out = rankMemories([old, fresh], { now: NOW, mode: 'recall' });
    expect(out[0].id).toBe('fresh');
  });

  it('down-weights unconfirmed below an otherwise-identical confirmed memory', () => {
    const confirmed = mk({ id: 'conf', status: 'confirmed', semanticSim: 0.5 });
    const unconfirmed = mk({ id: 'unconf', status: 'unconfirmed', semanticSim: 0.5 });
    const out = rankMemories([unconfirmed, confirmed], { now: NOW, mode: 'recall' });
    expect(out[0].id).toBe('conf');
    expect(out[1].id).toBe('unconf');
    // but it still surfaces (not filtered out) so a human can confirm/dismiss it
    expect(out).toHaveLength(2);
  });

  it('excludes archived / superseded / expired candidates', () => {
    const out = rankMemories([
      mk({ id: 'live' }),
      mk({ id: 'sup', superseded_by: 'x' }),
      mk({ id: 'arch', archived_at: '2026-06-21T00:00:00Z' }),
      mk({ id: 'exp', expires_at: '2000-01-01T00:00:00Z' }),
    ], { now: NOW, mode: 'recall' });
    expect(out.map((m) => m.id)).toEqual(['live']);
  });
});
