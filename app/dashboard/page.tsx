import Link from 'next/link';
import { getServerSupabase } from '@/src/lib/supabase/server';
import NewProject from './NewProject';

export default async function Dashboard() {
  const supabase = await getServerSupabase();
  const { data: projects } = await supabase.from('projects').select('id, name').order('created_at');
  return (
    <main className="mx-auto max-w-2xl p-8 space-y-6">
      <h1 className="text-xl font-semibold">Your projects</h1>
      <NewProject />
      <ul className="space-y-2">
        {(projects ?? []).map(p => (
          <li key={p.id}><Link className="underline" href={`/projects/${p.id}`}>{p.name}</Link></li>
        ))}
      </ul>
    </main>
  );
}
