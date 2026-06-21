import { createClient, type SupabaseClient } from '@supabase/supabase-js';
let cached: SupabaseClient | null = null;
export function getAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase admin env vars missing');
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
