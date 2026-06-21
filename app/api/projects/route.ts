import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/src/lib/supabase/server';
import { getAdmin } from '@/src/lib/supabase/admin';

const Body = z.object({ name: z.string().min(1).max(80) });

export async function POST(req: Request) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid name' }, { status: 400 });
  const { data: project, error } = await supabase.from('projects')
    .insert({ name: parsed.data.name, owner_id: user.id }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await getAdmin().from('project_members').insert({
    project_id: project.id, user_id: user.id, email: user.email!,
    display_name: user.user_metadata?.full_name ?? user.email,
  });
  return NextResponse.json({ id: project.id });
}
