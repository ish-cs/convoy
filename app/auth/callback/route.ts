import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/src/lib/supabase/server';
import { getAdmin } from '@/src/lib/supabase/admin';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (code) {
    const supabase = await getServerSupabase();
    await supabase.auth.exchangeCodeForSession(code);
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.email) {
      // Link any pending invites (rows created by email, not yet bound to a user).
      await getAdmin().from('project_members')
        .update({ user_id: user.id, display_name: user.user_metadata?.full_name ?? user.email })
        .eq('email', user.email).is('user_id', null);
    }
  }
  return NextResponse.redirect(new URL('/dashboard', url.origin));
}
