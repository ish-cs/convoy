#!/usr/bin/env node
// Codex adapter — posts the Convoy v1 ingest contract for edits made in Codex.
// Codex CLI's `notify` runs a program on turn-end (not per-edit), so the git-watcher core
// is the reliable per-edit capture; `notify` can additionally trigger an immediate `watch` tick.
import { run } from '../core.mjs';
run('codex');
