import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemoryRow } from '../types/db';

// Recall is additive: any failure returns [] so it never blocks coordination.
export async function recallMemory(db: SupabaseClient, a: { query: string; projectId: string }): Promise<MemoryRow[]> {
  const { data, error } = await db.rpc('recall_memory', { p: a.projectId, q: a.query ?? '' });
  if (error) return [];
  return (data ?? []) as MemoryRow[];
}
