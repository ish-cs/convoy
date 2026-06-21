import { getServerSupabase } from '@/src/lib/supabase/server';
import LiveView from './LiveView';
import InvitePanel from './InvitePanel';
import InstallCommand from './InstallCommand';
import Roster from './Roster';
import MemoryPanel from './MemoryPanel';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: project } = await supabase.from('projects').select('id, name, owner_id').eq('id', id).single();
  if (!project) return <main className="p-8">Not found.</main>;
  const { data: me } = await supabase.from('project_members').select('token').eq('project_id', id).eq('user_id', user!.id).maybeSingle();
  const isOwner = project.owner_id === user!.id;
  return (
    <main className="mx-auto max-w-3xl p-8 space-y-8">
      <h1 className="text-xl font-semibold">{project.name}</h1>
      {me?.token && <InstallCommand token={me.token} />}
      {isOwner && <InvitePanel projectId={id} />}
      {isOwner && <Roster projectId={id} />}
      {me && <MemoryPanel projectId={id} />}
      <LiveView projectId={id} />
    </main>
  );
}
