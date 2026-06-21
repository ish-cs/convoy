import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/src/lib/supabase/server';
import { getAdmin } from '@/src/lib/supabase/admin';
import { sendInviteEmail } from '@/src/lib/email';

const Body = z.object({ email: z.string().email() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await ctx.params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: project } = await supabase.from('projects').select('name, owner_id').eq('id', projectId).single();
  if (!project || project.owner_id !== user.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid email' }, { status: 400 });
  const { data, error } = await getAdmin().from('project_members')
    .insert({ project_id: projectId, email: parsed.data.email.toLowerCase() }).select('id, token').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  await sendInviteEmail(parsed.data.email, project.name).catch(() => {});
  return NextResponse.json({ memberId: data.id });
}
