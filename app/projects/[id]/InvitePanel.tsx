'use client';
import { useState } from 'react';
export default function InvitePanel({ projectId }: { projectId: string }) {
  const [email, setEmail] = useState(''); const [msg, setMsg] = useState('');
  const invite = async () => {
    const res = await fetch(`/api/projects/${projectId}/invite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    setMsg(res.ok ? 'Invited — they get an email to sign in.' : 'Failed (already invited?).');
  };
  return (
    <section className="space-y-2">
      <h2 className="font-medium">Invite teammate</h2>
      <div className="flex gap-2">
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="teammate@email.com" className="flex-1 rounded border px-3 py-2" />
        <button onClick={invite} className="rounded border px-4">Invite</button>
      </div>
      {msg && <p className="text-sm text-gray-600">{msg}</p>}
    </section>
  );
}
