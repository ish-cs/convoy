import { NextResponse } from 'next/server';
import { getAdmin } from '@/src/lib/supabase/admin';
import { embed, EMBED_DIM } from '@/src/lib/embed';

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
    .select('id, text')
    .is('embedding', null)
    .is('archived_at', null)
    .is('superseded_by', null)
    .order('created_at', { ascending: true })
    .limit(BATCH);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let embedded = 0;
  const failed: string[] = [];
  for (const r of rows ?? []) {
    try {
      const vec = await embed(r.text);
      // pgvector input format is `[a,b,c]` — identical to a JSON array string.
      const { error: upErr } = await db.from('memory').update({ embedding: JSON.stringify(vec) }).eq('id', r.id);
      if (upErr) { failed.push(r.id); continue; }
      embedded++;
    } catch {
      failed.push(r.id);
    }
  }
  return NextResponse.json({ scanned: (rows ?? []).length, embedded, failed: failed.length, dim: EMBED_DIM });
}

// Vercel cron calls GET; allow POST for manual/programmatic triggers too.
export const GET = backfill;
export const POST = backfill;
