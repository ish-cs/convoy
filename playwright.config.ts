import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load .env.local into process.env for the E2E (admin keys + Supabase URL).
try {
  for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* env may be provided by the shell instead */ }

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'https://convoy-ish-c.vercel.app' },
});
