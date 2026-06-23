// Pure hybrid ranker — fuses the five signals into one score so recall and auto-attach use
// the SAME ranking logic, just with different weights. No DB, no I/O: candidates arrive with
// their fts/semantic signals precomputed by SQL; this only weighs and sorts.
//
//   file       coordination-native: does the memory touch a file in play right now (0|1)
//   fts        Postgres ts_rank of the row against the query (0..1)
//   semantic   cosine similarity of the row embedding to the query embedding (0..1)
//   recency    exponential decay over age (half-life RECENCY_HALFLIFE_DAYS)
//   confidence row confidence (human 1.0, agent 0.6, unconfirmed lower)

import { normalizePath } from './overlap';
import { isActive } from './memory-core';
import type { MemoryRow } from '../types/db';

export type RankSignals = { ftsRank?: number; semanticSim?: number };
export type RankCandidate = MemoryRow & RankSignals;
export type RankMode = 'attach' | 'recall';

export const RANK_WEIGHTS: Record<RankMode, { file: number; fts: number; semantic: number; recency: number; confidence: number }> = {
  // auto-attach to an overlap alert: the file is the whole reason we're surfacing memory.
  attach: { file: 0.55, fts: 0.10, semantic: 0.15, recency: 0.10, confidence: 0.10 },
  // explicit query recall: meaning matters most; file presence is a mild boost.
  recall: { file: 0.15, fts: 0.25, semantic: 0.40, recency: 0.10, confidence: 0.10 },
};

export const RECENCY_HALFLIFE_DAYS = 30;

// Auto-extracted memories start life `unconfirmed` (a proposal, not a decision). They still
// surface — so a human can confirm/dismiss them — but ranked below confirmed memories of equal
// strength. Multiplicative so the penalty applies uniformly across attach and recall modes.
export const UNCONFIRMED_RANK_FACTOR = 0.5;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

function recencyScore(createdAt: string, now: number): number {
  const ageDays = (now - new Date(createdAt).getTime()) / 86_400_000;
  return Math.pow(0.5, Math.max(0, ageDays) / RECENCY_HALFLIFE_DAYS);
}

export function rankMemories(
  candidates: RankCandidate[],
  opts: { files?: string[]; now?: number; mode: RankMode },
): Array<RankCandidate & { score: number }> {
  const now = opts.now ?? Date.now();
  const wanted = new Set((opts.files ?? []).map(normalizePath));
  const w = RANK_WEIGHTS[opts.mode];
  return candidates
    .filter((m) => isActive(m, now))
    .map((m) => {
      const file = wanted.size && m.file_paths.some((p) => wanted.has(normalizePath(p))) ? 1 : 0;
      const fts = clamp01(m.ftsRank ?? 0);
      const semantic = clamp01(m.semanticSim ?? 0);
      const recency = recencyScore(m.created_at, now);
      const confidence = clamp01(m.confidence ?? 0);
      const raw = w.file * file + w.fts * fts + w.semantic * semantic + w.recency * recency + w.confidence * confidence;
      const score = raw * (m.status === 'unconfirmed' ? UNCONFIRMED_RANK_FACTOR : 1);
      return { ...m, score };
    })
    .sort((a, b) => b.score - a.score);
}
