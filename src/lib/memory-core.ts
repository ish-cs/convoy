import { createHash } from 'node:crypto';
import { normalizePath, type OverlapAlert } from './overlap';
import type { MemoryRow } from '../types/db';

export function contentHash(text: string, filePaths: string[]): string {
  const paths = [...filePaths.map(normalizePath)].sort().join('|');
  return createHash('sha256').update(text.trim() + '::' + paths).digest('hex');
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9]{20,}/, 'OpenAI-style secret key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/ghp_[A-Za-z0-9]{36}/, 'GitHub token'],
  [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, 'private key'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
];
export function detectSecret(text: string): string | null {
  for (const [re, label] of SECRET_PATTERNS) if (re.test(text)) return `looks like a ${label}`;
  return null;
}

function active(m: MemoryRow, now = Date.now()): boolean {
  return m.archived_at == null && m.superseded_by == null &&
    (m.expires_at == null || new Date(m.expires_at).getTime() > now);
}
export function matchMemoriesForFiles(memories: MemoryRow[], files: string[]): MemoryRow[] {
  const wanted = new Set(files.map(normalizePath));
  const seen = new Set<string>();
  return memories
    .filter(m => active(m))
    .filter(m => m.file_paths.some(p => wanted.has(normalizePath(p))))
    .filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

// Attach up to 3 relevant memories to each overlap alert (by the alert's file).
export function attachMemory(alerts: OverlapAlert[], memories: MemoryRow[]): Array<OverlapAlert & { memory: MemoryRow[] }> {
  return alerts.map(a => ({ ...a, memory: matchMemoriesForFiles(memories, [a.file]).slice(0, 3) }));
}
