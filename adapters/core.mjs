#!/usr/bin/env node
// Convoy universal adapter core.
//
// Claude Code posts to Convoy via its native PostToolUse/Stop hooks (see cli/hook.mjs).
// Cursor, Copilot, and Codex do NOT expose an equivalent per-edit shell hook — but they all
// edit files on disk in a git repo. So the honest, tool-agnostic capture is a git-watcher:
// watch the working tree, and on change post the *actual* changed files (from `git status`)
// as a v1 ingest contract tagged with this tool's source_tool. Downstream is identical to
// Claude Code (overlap fires, memory recalls) — that's the whole point of the v1 contract.
//
// Each tool's bin (adapters/<tool>/bin.mjs) is a 3-line wrapper that calls run() with its
// source_tool. The pure helpers below are unit-tested from tests/adapter-core.test.ts.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { watch } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const INGEST = process.env.CONVOY_INGEST_URL || 'https://convoy-ish-c.vercel.app/api/ingest';
const CONFIG_DIR = join(homedir(), '.convoy');

// Mirror of src/lib/repo-path.ts toRepoRelative (kept in sync; plain .mjs can't import the TS util).
// Canonical repo-relative path so the same logical file matches across machines/checkouts/OSes.
export function toRepoRelative(absPath, repoRoot) {
  let p = String(absPath).replace(/\\/g, '/');
  const root = String(repoRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (root && p.startsWith(root + '/')) p = p.slice(root.length + 1);
  return p.replace(/^[A-Za-z]:\//, '').replace(/^\.?\//, '').replace(/\/+/g, '/');
}

// Parse `git status --porcelain -z`-ish (we use plain --porcelain) into repo-relative paths.
// Porcelain lines look like ` M src/a.ts`, `?? new.ts`, `R  old -> new`. We take the path
// after the 2-char status (and the post-arrow path for renames). Already repo-relative.
export function parsePorcelain(out) {
  const files = [];
  for (const line of String(out).split('\n')) {
    if (line.length < 4) continue;
    let path = line.slice(3);
    const arrow = path.indexOf(' -> ');
    if (arrow !== -1) path = path.slice(arrow + 4);
    path = path.replace(/^"|"$/g, '').trim();
    if (path) files.push(path);
  }
  return [...new Set(files)];
}

// Build the v1 edit contract this adapter posts. Pure — tested directly.
/**
 * @param {{ sessionId: string, sourceTool: string, repo?: string, branch?: string | null, files?: string[] }} a
 */
export function buildEditContract({ sessionId, sourceTool, repo = undefined, branch = null, files = [] }) {
  return {
    v: 1,
    repo: repo ?? undefined,
    branch: branch ?? null,
    files,
    session_id: sessionId,
    source_tool: sourceTool,
    event: { kind: 'edit', message: files.length === 1 ? `edited ${files[0]}` : `edited ${files.length} files` },
  };
}

function loadToken() {
  if (process.env.CONVOY_TOKEN) return process.env.CONVOY_TOKEN;
  try { return readFileSync(join(CONFIG_DIR, 'token'), 'utf8').trim(); } catch { return null; }
}

function gitInfo(cwd) {
  const run = (cmd) => { try { return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
  const repoRoot = run('git rev-parse --show-toplevel') || cwd;
  const branch = run('git branch --show-current') || null;
  const repo = run('git config --get remote.origin.url') || undefined;
  return { repoRoot, branch, repo };
}

async function post(body, token) {
  try {
    const res = await fetch(INGEST, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch { return false; }
}

// `connect <token>` — store the member token (same token a `convoy-cli connect` uses).
export function connect(token, sourceTool) {
  if (!token || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    console.error('usage: convoy-<tool> connect <token>  (copy the exact connect token from your project page)');
    process.exit(1);
  }
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(join(CONFIG_DIR, 'token'), token, { mode: 0o600 });
  console.log(`Convoy connected for ${sourceTool}. Run \`convoy-${sourceTool} watch\` in your repo to start sharing context.`);
}

// `watch` — long-running git-watcher. Debounces fs events, posts the real changed files.
export function watchRepo(sourceTool) {
  const token = loadToken();
  if (!token) { console.error(`Not connected. Run: convoy-${sourceTool} connect <token>`); process.exit(1); }
  const cwd = process.cwd();
  const { repoRoot, repo } = gitInfo(cwd);
  const sessionId = `${sourceTool}-${randomUUID()}`;
  let timer = null, idleTimer = null, lastPosted = '';

  const tick = async () => {
    const { branch } = gitInfo(repoRoot);
    let porcelain = '';
    try { porcelain = execSync('git status --porcelain', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { return; }
    const files = parsePorcelain(porcelain).map((f) => toRepoRelative(f, repoRoot));
    if (!files.length) return;
    const key = files.join('|');
    if (key === lastPosted) return; // no new change since last post
    lastPosted = key;
    const ok = await post(buildEditContract({ sessionId, sourceTool, repo, branch, files }), token);
    console.log(`${ok ? '→' : '✗'} convoy[${sourceTool}] ${files.length} file(s)${ok ? '' : ' (post failed)'}`);
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, 1500); // debounce bursts of writes
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { void post({ v: 1, session_id: sessionId, source_tool: sourceTool, event: { kind: 'idle' } }, token); }, 90_000);
  };

  console.log(`convoy[${sourceTool}] watching ${repoRoot} — session ${sessionId}`);
  try {
    watch(repoRoot, { recursive: true }, (_e, name) => {
      if (!name) return;
      const n = String(name);
      if (n.includes('.git/') || n.includes('node_modules/') || n.includes('/dist/') || n.includes('/.next/')) return;
      schedule();
    });
  } catch (e) {
    console.error(`watch failed: ${e.message}. (recursive fs.watch needs macOS/Windows; on Linux use a polling driver.)`);
    process.exit(1);
  }
}

// Shared bin entrypoint. Each adapter's bin.mjs calls run(sourceTool).
export function run(sourceTool) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'connect') connect(arg, sourceTool);
  else if (cmd === 'watch') watchRepo(sourceTool);
  else { console.error(`commands: connect <token> | watch`); process.exit(1); }
}
