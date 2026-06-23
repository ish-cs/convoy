#!/usr/bin/env node
// GitHub Copilot adapter — posts the Convoy v1 ingest contract for edits made in Copilot.
// Copilot has no native per-edit shell hook, so this drives the shared git-watcher core.
import { run } from '../core.mjs';
run('copilot');
