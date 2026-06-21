import { getAdmin } from '../supabase/admin';
import type { MemberRow } from '../../types/db';
export async function resolveMember(token: string): Promise<MemberRow | null> {
  if (!token) return null;
  const { data, error } = await getAdmin()
    .from('project_members').select('*').eq('token', token).is('revoked_at', null).maybeSingle();
  if (error || !data) return null;
  return data as MemberRow;
}
