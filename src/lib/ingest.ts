import { getAdmin } from './supabase/admin';
import type { MemberRow } from '../types/db';
export async function ingestEdit(
  member: MemberRow,
  a: { session_id: string; branch: string | null; files: string[]; message?: string },
): Promise<void> {
  const { error } = await getAdmin().rpc('ingest_edit', {
    p_member: member.id, p_session: a.session_id, p_project: member.project_id,
    p_branch: a.branch, p_files: a.files, p_message: a.message ?? `edited ${a.files[0] ?? ''}`,
  });
  if (error) throw new Error(`ingestEdit failed: ${error.message}`);
}
export async function ingestIdle(member: MemberRow, a: { session_id: string }): Promise<void> {
  const { error } = await getAdmin().from('member_status')
    .update({ ended_at: new Date().toISOString() })
    .eq('member_id', member.id).eq('session_id', a.session_id);
  if (error) throw new Error(`ingestIdle failed: ${error.message}`);
}
