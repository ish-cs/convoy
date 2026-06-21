// Loads .env.local into process.env for integration tests (no external dep).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
try {
  const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
} catch {
  // no .env.local — env may be provided externally (CI)
}
