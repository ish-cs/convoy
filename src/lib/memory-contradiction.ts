import { normalizePath } from './overlap';

// A contradiction is two memories about the SAME topic (high embedding similarity) whose TEXT
// differs — i.e. one likely overrides/conflicts with the other and a human should resolve it.
// We deliberately exclude near-duplicates (sim >= MAX, same fact restated) and exact dupes
// (same content_hash) — those are not conflicts. Detection needs embeddings, so it runs at
// backfill time (the write path never embeds — see Global Constraints), not on `remember`.
// Band calibrated against live Gemini-001 384-dim vectors: a real same-topic/opposite-policy
// pair ("tokens in http-only cookies" vs "tokens in localStorage") lands at ~0.78, while an
// unrelated memory sits well below MIN — see tests/memory-contradiction-int.test.ts.
export const CONTRA_SIM_MIN = 0.70;
export const CONTRA_SIM_MAX = 0.97;

export type ContradictionCandidate = {
  id: string;
  text: string;
  content_hash: string;
  embedding: number[];
  file_paths?: string[];
  tags?: string[];
};

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 0 ? dot / d : 0;
}

function norm(t: string): string { return t.trim().toLowerCase().replace(/\s+/g, ' '); }

// Returns the ids of existing memories that contradict `incoming`. Pure — no I/O.
export function findContradictions(
  incoming: ContradictionCandidate,
  existing: ContradictionCandidate[],
): string[] {
  const incText = norm(incoming.text);
  return existing
    .filter(e =>
      e.id !== incoming.id &&
      e.content_hash !== incoming.content_hash &&
      norm(e.text) !== incText &&
      Array.isArray(e.embedding) && e.embedding.length === incoming.embedding.length &&
      (() => { const s = cosine(incoming.embedding, e.embedding); return s >= CONTRA_SIM_MIN && s < CONTRA_SIM_MAX; })(),
    )
    .map(e => e.id);
}

// Cheap shared-subject check (no embeddings) — used only to label, not to gate.
export function sharesSubject(a: ContradictionCandidate, b: ContradictionCandidate): boolean {
  const af = new Set((a.file_paths ?? []).map(normalizePath));
  if ((b.file_paths ?? []).some(p => af.has(normalizePath(p)))) return true;
  const at = new Set(a.tags ?? []);
  return (b.tags ?? []).some(t => at.has(t));
}
