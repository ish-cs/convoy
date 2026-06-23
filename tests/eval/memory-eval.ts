import fixtures from './fixtures.json';
import { embed } from '../../src/lib/embed';
import { cosine } from '../../src/lib/memory-contradiction';
import { rankMemories, type RankCandidate } from '../../src/lib/memory-rank';
import type { MemoryRow } from '../../src/types/db';

// Recall quality gate. For each question we embed it, score every fixture memory by cosine
// similarity, run the SAME production ranker (recall mode), and check the expected memory lands
// in the top 3. This measures the embed + ranker path end-to-end against real Gemini vectors.
// FTS is 0 here (no Postgres in-process) — this isolates the semantic signal the ranker leans on.
export type EvalMiss = { q: string; expect: string; got: string[] };
export type EvalResult = { total: number; hits: number; hitRate: number; misses: EvalMiss[] };

type Fixture = { id: string; text: string; file_paths: string[] };

const CREATED = '2026-06-21T00:00:00Z';
function asRow(m: Fixture, semanticSim: number): RankCandidate {
  const base: MemoryRow = {
    id: m.id, project_id: 'eval', author_member_id: 'eval', author_kind: 'human', source_tool: 'eval',
    text: m.text, file_paths: m.file_paths, branch: null, tags: [], status: 'confirmed', confidence: 1,
    superseded_by: null, content_hash: m.id, contradicts: [], ref_count: 0, created_at: CREATED,
    last_referenced_at: null, expires_at: null, archived_at: null,
  };
  return { ...base, semanticSim, ftsRank: 0 };
}

export async function runEval(): Promise<EvalResult> {
  const memories = fixtures.memories as Fixture[];
  const questions = fixtures.questions as Array<{ q: string; expect: string; files?: string[] }>;

  // Embed all memories once.
  const memEmb = new Map<string, number[]>();
  for (const m of memories) memEmb.set(m.id, await embed(m.text));

  const misses: EvalMiss[] = [];
  let hits = 0;
  for (const question of questions) {
    const qe = await embed(question.q);
    const candidates = memories.map(m => asRow(m, cosine(qe, memEmb.get(m.id)!)));
    const ranked = rankMemories(candidates, { files: question.files, mode: 'recall', now: Date.parse(CREATED) });
    const top3 = ranked.slice(0, 3).map(r => r.id);
    if (top3.includes(question.expect)) hits++;
    else misses.push({ q: question.q, expect: question.expect, got: top3 });
  }
  const total = questions.length;
  return { total, hits, hitRate: total ? hits / total : 0, misses };
}
