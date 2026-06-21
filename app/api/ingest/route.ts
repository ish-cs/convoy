import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveMember } from '@/src/lib/mcp/auth';
import { ingestEdit, ingestIdle } from '@/src/lib/ingest';

const Body = z.object({
  session_id: z.string().min(1),
  kind: z.enum(['edit', 'idle']),
  branch: z.string().nullable().optional(),
  files: z.array(z.string()).optional(),
  message: z.string().optional(),
});

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const member = await resolveMember(token);
  if (!member) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const b = parsed.data;

  if (b.kind === 'idle') await ingestIdle(member, { session_id: b.session_id });
  else await ingestEdit(member, { session_id: b.session_id, branch: b.branch ?? null, files: b.files ?? [], message: b.message });

  return NextResponse.json({ ok: true });
}
