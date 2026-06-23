import { NextResponse } from 'next/server';
import { getAdmin } from '@/src/lib/supabase/admin';
import { extractMemories } from '@/src/lib/llm';
import { insertMemory } from '@/src/lib/memory-write';
import type { EventRow } from '@/src/types/db';

// Auto-extract proposer. Server-to-server (CRON_SECRET) — meant to be fired when a session ends
// (e.g. by the CLI hook) with that session's id. OFF unless the project opted in. Drafts are
// `unconfirmed`/low-confidence; idempotent via content_hash so re-running never duplicates.
export const runtime = 'nodejs';
export const maxDuration = 60;

async function extract(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });

  const db = getAdmin();
  const { data: events, error } = await db.from('events')
    .select('*').eq('session_id', sessionId).order('ts', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!events?.length) return NextResponse.json({ skipped: 'no events for session' });

  const first = events[0] as EventRow;
  const { data: project } = await db.from('projects').select('auto_extract').eq('id', first.project_id).single();
  if (!project?.auto_extract) return NextResponse.json({ skipped: 'auto_extract off for project' });

  let drafted = 0, deduped = 0;
  try {
    const drafts = await extractMemories((events as EventRow[]).map(e => ({ message: e.message, files: e.files })));
    for (const d of drafts) {
      const { deduped: dup } = await insertMemory(db, {
        projectId: first.project_id, authorMemberId: first.member_id, authorKind: 'agent',
        sourceTool: 'auto-extract', text: d.text, filePaths: d.file_paths, branch: first.branch,
        status: 'unconfirmed', confidence: d.confidence,
      });
      if (dup) deduped++; else drafted++;
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  return NextResponse.json({ sessionId, events: events.length, drafted, deduped });
}

export const POST = extract;
