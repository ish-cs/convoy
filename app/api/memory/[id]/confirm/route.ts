import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/src/lib/supabase/server';
import { getAdmin } from '@/src/lib/supabase/admin';

// Promote an auto-extracted (unconfirmed) memory to confirmed. Mirrors the archive route's
// member-of-project authorization.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: memoryId } = await ctx.params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const admin = getAdmin();
  const { data: mem } = await admin.from('memory').select('project_id').eq('id', memoryId).single();
  if (!mem) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { data: member } = await supabase.from('project_members')
    .select('id').eq('project_id', mem.project_id).eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { error } = await admin.from('memory').update({ status: 'confirmed' }).eq('id', memoryId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
