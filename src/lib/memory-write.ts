import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePath } from './overlap';
import { contentHash, detectSecret } from './memory-core';

export async function insertMemory(adminDb: SupabaseClient, a: {
  projectId: string; authorMemberId: string; authorKind: 'human'|'agent'; sourceTool: string;
  text: string; filePaths?: string[]; branch?: string|null; tags?: string[];
}): Promise<{ id: string; deduped: boolean }> {
  const text = (a.text ?? '').trim();
  if (!text) throw new Error('memory text required');
  const secret = detectSecret(text);
  if (secret) throw new Error(`refusing to store memory: ${secret}`);
  const file_paths = (a.filePaths ?? []).map(normalizePath);
  const hash = contentHash(text, file_paths);
  const row = {
    project_id: a.projectId, author_member_id: a.authorMemberId,
    author_kind: a.authorKind, source_tool: a.sourceTool,
    text, file_paths, branch: a.branch ?? null, tags: a.tags ?? [],
    confidence: a.authorKind === 'human' ? 1.0 : 0.6,
    content_hash: hash,
  };
  // Dedup against active rows — mirrors the partial unique index
  // (project_id, content_hash) where archived_at is null. supabase-js upsert
  // can't target a partial index, so we check-then-insert with a race fallback.
  const findActive = () => adminDb.from('memory')
    .select('id').eq('project_id', a.projectId).eq('content_hash', hash).is('archived_at', null).maybeSingle();
  const existing = await findActive();
  if (existing.data) return { id: existing.data.id, deduped: true };
  const { data, error } = await adminDb.from('memory').insert(row).select('id').single();
  if (error) {
    if ((error as { code?: string }).code === '23505') { // lost an insert race
      const dup = await findActive();
      if (dup.data) return { id: dup.data.id, deduped: true };
    }
    throw new Error(`insertMemory failed: ${error.message}`);
  }
  return { id: data!.id, deduped: false };
}
