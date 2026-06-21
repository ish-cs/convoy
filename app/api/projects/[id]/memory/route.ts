import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/src/lib/supabase/server';
import { getAdmin } from '@/src/lib/supabase/admin';
import { insertMemory } from '@/src/lib/memory-write';

const Body = z.object({
  text: z.string().min(1),
  file_paths: z.array(z.string()).optional(),
  branch: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await ctx.params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: member } = await supabase.from('project_members')
    .select('id').eq('project_id', projectId).eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid memory' }, { status: 400 });
  try {
    const { id } = await insertMemory(getAdmin(), {
      projectId, authorMemberId: member.id, authorKind: 'human', sourceTool: 'web',
      text: parsed.data.text, filePaths: parsed.data.file_paths, branch: parsed.data.branch, tags: parsed.data.tags,
    });
    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
