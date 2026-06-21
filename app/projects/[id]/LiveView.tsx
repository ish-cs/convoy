'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { getBrowserSupabase } from '@/src/lib/supabase/client';
import { computeOverlap, type MemberSnapshot } from '@/src/lib/overlap';
import { matchMemoriesForFiles } from '@/src/lib/memory-core';
import type { StatusRow, EventRow, MemoryRow } from '@/src/types/db';
export default function LiveView({ projectId }: { projectId: string }) {
  // One client instance for the whole component — queries AND the realtime channel
  // must share the same authenticated socket, or postgres_changes is evaluated as anon.
  const sb = useMemo(() => getBrowserSupabase(), []);
  const [status, setStatus] = useState<StatusRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const load = useCallback(async () => {
    const [{ data: s }, { data: e }, { data: m }, { data: mem }] = await Promise.all([
      sb.from('member_status').select('*').eq('project_id', projectId).is('ended_at', null),
      sb.from('events').select('*').eq('project_id', projectId).order('ts', { ascending: false }).limit(50),
      sb.from('project_members').select('id, display_name, email').eq('project_id', projectId),
      sb.from('memory').select('*').eq('project_id', projectId).is('archived_at', null).is('superseded_by', null),
    ]);
    setStatus(s ?? []); setEvents(e ?? []); setMemories((mem ?? []) as MemoryRow[]);
    setNames(Object.fromEntries((m ?? []).map((x: { id: string; display_name: string | null; email: string }) => [x.id, x.display_name || x.email])));
  }, [projectId, sb]);
  useEffect(() => {
    let ch: ReturnType<typeof sb.channel> | undefined;
    (async () => {
      // Authenticate the realtime socket so RLS lets the change feed through.
      const { data: { session } } = await sb.auth.getSession();
      if (session) sb.realtime.setAuth(session.access_token);
      await load();
      ch = sb.channel(`proj-${projectId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'member_status', filter: `project_id=eq.${projectId}` }, load)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `project_id=eq.${projectId}` }, load)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'memory', filter: `project_id=eq.${projectId}` }, load)
        .subscribe();
    })();
    return () => { if (ch) sb.removeChannel(ch); };
  }, [projectId, load, sb]);

  const snaps: MemberSnapshot[] = status.map(s => ({
    memberId: s.member_id, displayName: names[s.member_id] ?? 'teammate', branch: s.branch, files: s.files, lastActivityAt: s.updated_at,
  }));
  const banners = snaps.flatMap((me, i) =>
    computeOverlap({ files: me.files, branch: me.branch }, snaps.slice(i + 1), new Date())
      .map(a => ({ label: `${me.displayName} & ${a.displayName} both on ${a.file}`, file: a.file })));

  return (
    <section className="space-y-6">
      {banners.map((b, i) => (
        <div key={i} className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <div>⚠️ {b.label}</div>
          {matchMemoriesForFiles(memories, [b.file]).slice(0, 3).map(m => (
            <div key={m.id} className="mt-1 text-xs text-red-700">💡 {m.text}</div>
          ))}
        </div>
      ))}
      <div>
        <h2 className="font-medium">Active sessions</h2>
        <div className="grid gap-3 sm:grid-cols-2 mt-2">
          {status.map(s => (
            <div key={`${s.member_id}-${s.session_id}`} className="rounded border p-3">
              <div className="font-medium">{names[s.member_id] ?? 'teammate'}</div>
              <div className="text-xs text-gray-500">{s.branch ?? 'no branch'} · {new Date(s.updated_at).toLocaleTimeString()}</div>
              <div className="text-xs text-gray-500 mt-1">{s.files.join(', ')}</div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h2 className="font-medium">Activity</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {events.map(e => (
            <li key={e.id} className="text-gray-700">
              <span className="text-gray-400">{new Date(e.ts).toLocaleTimeString()}</span>{' '}
              <span className="font-medium">{names[e.member_id] ?? 'teammate'}</span> {e.message}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
