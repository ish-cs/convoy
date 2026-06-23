'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { getBrowserSupabase } from '@/src/lib/supabase/client';
import type { MemoryRow } from '@/src/types/db';

export default function MemoryPanel({ projectId }: { projectId: string }) {
  const sb = useMemo(() => getBrowserSupabase(), []);
  const [rows, setRows] = useState<MemoryRow[]>([]);
  const [text, setText] = useState('');
  const [files, setFiles] = useState('');
  const [tags, setTags] = useState('');
  const [msg, setMsg] = useState('');
  const [autoExtract, setAutoExtract] = useState(false);

  const load = useCallback(async () => {
    const [memRes, projRes] = await Promise.all([
      sb.from('memory').select('*')
        .eq('project_id', projectId).is('archived_at', null).is('superseded_by', null)
        .order('created_at', { ascending: false }),
      sb.from('projects').select('auto_extract').eq('id', projectId).maybeSingle(),
    ]);
    setRows((memRes.data ?? []) as MemoryRow[]);
    setAutoExtract(!!projRes.data?.auto_extract);
  }, [projectId, sb]);

  useEffect(() => {
    let ch: ReturnType<typeof sb.channel> | undefined;
    (async () => {
      const { data: { session } } = await sb.auth.getSession();
      if (session) sb.realtime.setAuth(session.access_token);
      await load();
      ch = sb.channel(`mem-${projectId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'memory', filter: `project_id=eq.${projectId}` }, load)
        .subscribe();
    })();
    return () => { if (ch) sb.removeChannel(ch); };
  }, [projectId, load, sb]);

  const pin = async () => {
    if (!text.trim()) return;
    const body = {
      text,
      file_paths: files.split(',').map(s => s.trim()).filter(Boolean),
      tags: tags.split(',').map(s => s.trim()).filter(Boolean),
    };
    const res = await fetch(`/api/projects/${projectId}/memory`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) { setText(''); setFiles(''); setTags(''); setMsg(''); load(); }
    else { const j = await res.json().catch(() => ({})); setMsg(j.error || 'failed to pin'); }
  };
  const archive = async (id: string) => { await fetch(`/api/memory/${id}/archive`, { method: 'POST' }); load(); };
  const confirm = async (id: string) => { await fetch(`/api/memory/${id}/confirm`, { method: 'POST' }); load(); };
  const toggleAuto = async () => {
    const next = !autoExtract;
    setAutoExtract(next); // optimistic
    const res = await fetch(`/api/projects/${projectId}/auto-extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: next }) });
    if (!res.ok) setAutoExtract(!next);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Team memory</h2>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={autoExtract} onChange={toggleAuto} />
          Auto-extract from sessions
        </label>
      </div>
      <div className="space-y-2">
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="A decision, convention, or gotcha worth keeping…" className="w-full rounded border px-3 py-2 text-sm" rows={2} />
        <div className="flex gap-2">
          <input value={files} onChange={e => setFiles(e.target.value)} placeholder="files (comma-sep, e.g. src/auth.ts)" className="flex-1 rounded border px-3 py-2 text-sm" />
          <input value={tags} onChange={e => setTags(e.target.value)} placeholder="tags" className="w-40 rounded border px-3 py-2 text-sm" />
          <button onClick={pin} className="rounded border px-4 text-sm">Pin</button>
        </div>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
      </div>
      <ul className="space-y-1 text-sm">
        {rows.map(m => {
          const proposed = m.status === 'unconfirmed';
          return (
            <li key={m.id} className={`flex items-start justify-between gap-2 rounded border px-3 py-2 ${proposed ? 'border-dashed bg-gray-50 text-gray-500' : ''}`}>
              <span>
                {proposed ? '✨' : '💡'} {m.text}
                {proposed && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">proposed</span>}
                {m.contradicts.length > 0 && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] text-red-700">conflicts ×{m.contradicts.length}</span>}
                {m.file_paths.length > 0 && <span className="ml-1 text-xs text-gray-400">· {m.file_paths.join(', ')}</span>}
              </span>
              <span className="flex shrink-0 gap-2 text-xs">
                {proposed && <button onClick={() => confirm(m.id)} className="text-green-700 underline">Keep</button>}
                <button onClick={() => archive(m.id)} className="text-red-600 underline">{proposed ? 'Dismiss' : 'Archive'}</button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
