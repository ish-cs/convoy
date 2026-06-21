'use client';
import { useEffect, useState, useCallback } from 'react';
import { getBrowserSupabase } from '@/src/lib/supabase/client';
type Row = { id: string; email: string; display_name: string | null; user_id: string | null; revoked_at: string | null };
export default function Roster({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const load = useCallback(async () => {
    const { data } = await getBrowserSupabase().from('project_members')
      .select('id, email, display_name, user_id, revoked_at').eq('project_id', projectId);
    setRows(data ?? []);
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  const revoke = async (id: string) => { await fetch(`/api/members/${id}/revoke`, { method: 'POST' }); load(); };
  return (
    <section className="space-y-2">
      <h2 className="font-medium">Members</h2>
      <ul className="space-y-1 text-sm">
        {rows.map(r => (
          <li key={r.id} className="flex items-center justify-between rounded border px-3 py-2">
            <span>{r.display_name || r.email}{' '}
              <span className="text-xs text-gray-500">
                {r.revoked_at ? '· revoked' : r.user_id ? '· connected' : '· pending'}
              </span>
            </span>
            {!r.revoked_at && <button onClick={() => revoke(r.id)} className="text-xs text-red-600 underline">Revoke</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
