import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemoryRow } from '../types/db';
import { embed } from './embed';
import { rankMemories, type RankCandidate } from './memory-rank';

// Recall is additive: any failure returns [] so it never blocks coordination. The query is
// embedded for semantic recall; if embedding fails (no key / network / quota) we degrade to
// FTS-only (qe = null) rather than erroring. SQL returns candidates with both signals, the
// pure ranker fuses file/fts/semantic/recency/confidence.
export async function recallMemory(
  db: SupabaseClient,
  a: { query: string; projectId: string; files?: string[] },
): Promise<MemoryRow[]> {
  const query = (a.query ?? '').trim();
  let qe: number[] | null = null;
  if (query) {
    try { qe = await embed(query); } catch { qe = null; }
  }
  const { data, error } = await db.rpc('recall_memory_hybrid', { p: a.projectId, q: query, qe });
  if (error) return [];
  const candidates = (data ?? []).map((r: RankCandidate & { fts_rank?: number; semantic_sim?: number }): RankCandidate => ({
    ...r, ftsRank: r.fts_rank ?? 0, semanticSim: r.semantic_sim ?? 0,
  }));
  return rankMemories(candidates, { files: a.files, mode: 'recall' }).slice(0, 20);
}
