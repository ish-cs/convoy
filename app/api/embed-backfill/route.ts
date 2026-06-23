import { NextResponse } from 'next/server';
import { getAdmin } from '@/src/lib/supabase/admin';
import { embed, EMBED_DIM } from '@/src/lib/embed';
import { findContradictions, type ContradictionCandidate } from '@/src/lib/memory-contradiction';

// pgvector serializes to a JSON-array string (`"[0.1,0.2,...]"`); parse back to number[].
function parseVec(v: unknown): number[] {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

// Async embedding backfill: fills `embedding` for active memory rows where it's still null.
// This is the ONLY place embeddings are computed — never the write path (Global Constraints).
// Triggered by the Vercel cron (which injects `Authorization: Bearer ${CRON_SECRET}`) or
// manually with the same header. Additive: a per-row failure is skipped, never fatal to the
// batch, so coordination is never blocked by an embedding hiccup.

export const runtime = 'nodejs';
export const maxDuration = 60;

const BATCH = 50;

async function backfill(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getAdmin();
  const { data: rows, error } = await db
    .from('memory')
    .select('id, text, project_id, content_hash, file_paths, tags')
    .is('embedding', null)
    .is('archived_at', null)
    .is('superseded_by', null)
    .order('created_at', { ascending: true })
    .limit(BATCH);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let embedded = 0;
  let flagged = 0;
  const failed: string[] = [];
  for (const r of rows ?? []) {
    try {
      const vec = await embed(r.text);
      // pgvector input format is `[a,b,c]` — identical to a JSON array string.
      const { error: upErr } = await db.from('memory').update({ embedding: JSON.stringify(vec) }).eq('id', r.id);
      if (upErr) { failed.push(r.id); continue; }
      embedded++;

      // Contradiction detection (additive — never fails the embed). Compare the freshly-embedded
      // row against the project's other active embedded memories; flag same-topic/different-text
      // conflicts for human resolution. This is the ONLY place it runs (write path never embeds).
      try {
        const { data: others } = await db
          .from('memory')
          .select('id, text, content_hash, embedding, file_paths, tags')
          .eq('project_id', r.project_id)
          .is('archived_at', null)
          .is('superseded_by', null)
          .not('embedding', 'is', null)
          .neq('id', r.id);
        const candidates: ContradictionCandidate[] = (others ?? []).map(o => ({
          id: o.id, text: o.text, content_hash: o.content_hash, embedding: parseVec(o.embedding),
          file_paths: o.file_paths ?? [], tags: o.tags ?? [],
        }));
        const incoming: ContradictionCandidate = {
          id: r.id, text: r.text, content_hash: r.content_hash, embedding: vec,
          file_paths: r.file_paths ?? [], tags: r.tags ?? [],
        };
        const conflicts = findContradictions(incoming, candidates);
        if (conflicts.length) {
          await db.from('memory').update({ contradicts: conflicts }).eq('id', r.id);
          flagged++;
        }
      } catch { /* contradiction detection is best-effort; embedding already succeeded */ }
    } catch {
      failed.push(r.id);
    }
  }
  return NextResponse.json({ scanned: (rows ?? []).length, embedded, flagged, failed: failed.length, dim: EMBED_DIM });
}

// Vercel cron calls GET; allow POST for manual/programmatic triggers too.
export const GET = backfill;
export const POST = backfill;
