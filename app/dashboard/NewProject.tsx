'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewProject() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const create = async () => {
    if (busy || !name.trim()) return; // guard against double-submit + empty names
    setBusy(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) { const { id } = await res.json(); router.push(`/projects/${id}`); }
      else setBusy(false); // re-enable on failure so the user can retry
    } catch { setBusy(false); }
  };
  return (
    <div className="flex gap-2">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Project name" className="flex-1 rounded border px-3 py-2" />
      <button onClick={create} disabled={busy} className="rounded border px-4 py-2 disabled:opacity-50">{busy ? 'Creating…' : 'Create'}</button>
    </div>
  );
}
