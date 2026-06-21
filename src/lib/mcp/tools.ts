import { getAdmin } from '../supabase/admin';
import { computeOverlap, type MemberSnapshot, type OverlapAlert } from '../overlap';
import { OVERLAP_WINDOW_MINUTES } from '../constants';
import { insertMemory } from '../memory-write';
import type { MemberRow, StatusRow, EventRow } from '../../types/db';

export async function remember(
  member: MemberRow,
  args: { text: string; file_paths?: string[]; branch?: string | null; tags?: string[] },
  sourceTool = 'claude-code',
): Promise<{ id: string }> {
  const { id } = await insertMemory(getAdmin(), {
    projectId: member.project_id, authorMemberId: member.id, authorKind: 'agent', sourceTool,
    text: args.text, filePaths: args.file_paths, branch: args.branch, tags: args.tags,
  });
  return { id };
}

export async function setMyStatus(member: MemberRow, args: { summary: string }): Promise<void> {
  const { error } = await getAdmin().from('project_members')
    .update({ current_summary: args.summary, summary_updated_at: new Date().toISOString() })
    .eq('id', member.id);
  if (error) throw new Error(`setMyStatus failed: ${error.message}`);
}

export async function pullTeamContext(
  member: MemberRow,
  args: { branch?: string | null; files?: string[] },
  now: Date,
): Promise<{
  members: (StatusRow & { display_name: string | null; current_summary: string | null })[];
  recent_events: EventRow[];
  alerts: OverlapAlert[];
}> {
  const db = getAdmin();
  const cutoffIso = new Date(now.getTime() - OVERLAP_WINDOW_MINUTES * 60_000).toISOString();
  const [statusRes, eventsRes, membersRes] = await Promise.all([
    db.from('member_status').select('*').eq('project_id', member.project_id).is('ended_at', null),
    db.from('events').select('*').eq('project_id', member.project_id).gte('ts', cutoffIso).order('ts', { ascending: false }).limit(100),
    db.from('project_members').select('id, display_name, email, current_summary').eq('project_id', member.project_id),
  ]);
  if (statusRes.error) throw new Error(`pull(status): ${statusRes.error.message}`);
  if (eventsRes.error) throw new Error(`pull(events): ${eventsRes.error.message}`);
  if (membersRes.error) throw new Error(`pull(members): ${membersRes.error.message}`);

  const meta = new Map((membersRes.data ?? []).map((m: { id: string; display_name: string | null; email: string; current_summary: string | null }) => [m.id, m]));
  const allStatus = statusRes.data as StatusRow[];
  const events = eventsRes.data as EventRow[];
  const others = allStatus.filter(s => s.member_id !== member.id);

  // union recent event files per member (overlap should fire even if the file
  // dropped out of the current live session file list but was touched <window ago)
  const evFiles = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.member_id === member.id) continue;
    if (!evFiles.has(e.member_id)) evFiles.set(e.member_id, new Set());
    e.files.forEach(f => evFiles.get(e.member_id)!.add(f));
  }

  const snapshots: MemberSnapshot[] = others.map(s => ({
    memberId: s.member_id,
    displayName: meta.get(s.member_id)?.display_name || meta.get(s.member_id)?.email || 'teammate',
    branch: s.branch,
    files: Array.from(new Set([...s.files, ...(evFiles.get(s.member_id) ?? [])])),
    lastActivityAt: s.updated_at,
  }));

  const alerts = computeOverlap({ files: args.files ?? [], branch: args.branch ?? null }, snapshots, now, OVERLAP_WINDOW_MINUTES);
  const members = others.map(s => ({
    ...s,
    display_name: meta.get(s.member_id)?.display_name ?? null,
    current_summary: meta.get(s.member_id)?.current_summary ?? null,
  }));
  return { members, recent_events: events.filter(e => e.member_id !== member.id), alerts };
}
