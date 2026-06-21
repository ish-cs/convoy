import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/src/lib/supabase/server';
import { getAdmin } from '@/src/lib/supabase/admin';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: memberId } = await ctx.params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const admin = getAdmin();
  const { data: m } = await admin.from('project_members').select('project_id, projects(owner_id)').eq('id', memberId).single();
  // @ts-expect-error nested select typing
  if (!m || m.projects.owner_id !== user.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { error } = await admin.from('project_members').update({ revoked_at: new Date().toISOString() }).eq('id', memberId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
