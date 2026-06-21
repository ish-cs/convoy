'use client';
import { getBrowserSupabase } from '@/src/lib/supabase/client';

export default function Login() {
  const signIn = async () => {
    await getBrowserSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };
  return (
    <main className="min-h-screen grid place-items-center">
      <button onClick={signIn} className="rounded-md border px-4 py-2 font-medium">
        Sign in with Google
      </button>
    </main>
  );
}
