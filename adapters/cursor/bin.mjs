#!/usr/bin/env node
// Cursor adapter — posts the Convoy v1 ingest contract for edits made in Cursor.
// Cursor has no native per-edit shell hook, so this drives the shared git-watcher core.
import { run } from '../core.mjs';
run('cursor');
