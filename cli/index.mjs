#!/usr/bin/env node
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_URL = process.env.CONVOY_MCP_URL || 'https://convoy-ish-c.vercel.app/mcp';
const HOOK_CMD = `node ${join(homedir(), '.convoy/hook.mjs')}`;

function installHooks(settingsPath) {
  let s = {};
  try { s = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch {}
  s.hooks ??= {};
  const ensure = (event, matcher) => {
    s.hooks[event] ??= [];
    const exists = JSON.stringify(s.hooks[event]).includes('.convoy/hook.mjs');
    if (!exists) s.hooks[event].push(matcher ? { matcher, hooks: [{ type: 'command', command: HOOK_CMD }] }
                                            : { hooks: [{ type: 'command', command: HOOK_CMD }] });
  };
  ensure('PostToolUse', 'Edit|Write|MultiEdit');
  ensure('Stop', null);
  writeFileSync(settingsPath, JSON.stringify(s, null, 2));
}

function connect(token) {
  if (!token) { console.error('usage: convoy-cli connect <token>'); process.exit(1); }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    console.error('Invalid token format. Copy the exact connect token from your project page.');
    process.exit(1);
  }
  const dir = join(homedir(), '.convoy');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'token'), token, { mode: 0o600 });
  copyFileSync(join(HERE, 'hook.mjs'), join(dir, 'hook.mjs'));
  try {
    // execFileSync (no shell) — token is passed as a single argv entry, not interpolated into a command string.
    execFileSync('claude', ['mcp', 'add', '--transport', 'http', 'convoy', MCP_URL, '-H', `Authorization: Bearer ${token}`], { stdio: 'inherit' });
  } catch { console.warn('Could not run `claude mcp add` automatically — add it manually (see README).'); }
  installHooks(join(homedir(), '.claude', 'settings.json'));
  console.log('Convoy connected. Restart Claude Code sessions to load the hooks.');
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'connect') connect(arg);
else if (cmd === 'hook') await import(join(homedir(), '.convoy/hook.mjs'));
else { console.error('commands: connect <token> | hook'); process.exit(1); }
