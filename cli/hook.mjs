#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const INGEST = process.env.CONVOY_INGEST_URL || 'https://convoy-ish-c.vercel.app/api/ingest';

function relativize(fp, cwd) { return fp.startsWith(cwd + '/') ? fp.slice(cwd.length + 1) : fp; }

async function main() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch {}
  let p = {};
  try { p = JSON.parse(raw || '{}'); } catch {}

  let token = process.env.CONVOY_TOKEN;
  if (!token) { try { token = readFileSync(join(homedir(), '.convoy/token'), 'utf8').trim(); } catch {} }
  if (!token || !p.session_id) process.exit(0);

  const cwd = p.cwd || process.cwd();
  let branch = null;
  try { branch = execSync('git branch --show-current', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; } catch {}

  let body;
  if (p.hook_event_name === 'Stop') {
    body = { session_id: p.session_id, kind: 'idle' };
  } else {
    const fp = p.tool_input?.file_path;
    if (!fp) process.exit(0);
    const file = relativize(fp, cwd);
    body = { session_id: p.session_id, kind: 'edit', branch, files: [file], message: `edited ${file}` };
  }
  try {
    await fetch(INGEST, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
  } catch {} // best-effort: never block the edit
  process.exit(0);
}
main();
