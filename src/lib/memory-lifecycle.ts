import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePath } from './overlap';
import { contentHash, detectSecret } from './memory-core';

// Insert a replacement memory and point the old one at it (atomic via supersede_memory).
export async function supersedeMemory(adminDb: SupabaseClient, a: {
  oldId: string; projectId: string; authorMemberId: string; authorKind: 'human'|'agent';
  sourceTool: string; text: string; filePaths?: string[]; branch?: string|null; tags?: string[];
}): Promise<{ id: string }> {
  const text = (a.text ?? '').trim();
  if (!text) throw new Error('memory text required');
  const secret = detectSecret(text);
  if (secret) throw new Error(`refusing to store memory: ${secret}`);
  const file_paths = (a.filePaths ?? []).map(normalizePath);
  const { data, error } = await adminDb.rpc('supersede_memory', {
    p_old: a.oldId, p_project: a.projectId, p_author: a.authorMemberId,
    p_kind: a.authorKind, p_source: a.sourceTool, p_text: text,
    p_files: file_paths, p_branch: a.branch ?? null, p_tags: a.tags ?? [],
    p_hash: contentHash(text, file_paths),
  });
  if (error) throw new Error(`supersedeMemory failed: ${error.message}`);
  return { id: data as string };
}

// Archive (soft-delete) a memory, project-scoped.
export async function archiveMemory(adminDb: SupabaseClient, a: { id: string; projectId: string }): Promise<void> {
  const { error } = await adminDb.from('memory')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', a.id).eq('project_id', a.projectId);
  if (error) throw new Error(`archiveMemory failed: ${error.message}`);
}
