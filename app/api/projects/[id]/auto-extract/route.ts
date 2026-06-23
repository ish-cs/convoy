import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/src/lib/supabase/server';
import { getAdmin } from '@/src/lib/supabase/admin';

// Toggle a project's auto-extract opt-in. Any member of the project may flip it.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await ctx.params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: member } = await supabase.from('project_members')
    .select('id').eq('project_id', projectId).eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const enabled = !!body?.enabled;
  const { error } = await getAdmin().from('projects').update({ auto_extract: enabled }).eq('id', projectId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, auto_extract: enabled });
}
