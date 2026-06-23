# Convoy adapters — bring any tool into a Convoy project

Convoy is the neutral coordination + memory layer **between** agent tools. These adapters let
non-Claude tools post the same [v1 ingest contract](../docs/ingest-contract.md) Claude Code
posts, so their edits and memory are **indistinguishable downstream**: overlap alerts fire and
memory recalls regardless of which tool produced the data.

## How capture works per tool (honest — no silent gaps)

| Tool | Native per-edit hook? | How this adapter captures | Status |
|------|----------------------|---------------------------|--------|
| **Claude Code** | ✅ `PostToolUse` / `Stop` | `cli/hook.mjs` (exact edited file, instant) | ✅ shipped (`convoy-cli`) |
| **Cursor** | ❌ none exposed | shared **git-watcher** (`adapters/core.mjs`) | ✅ wired |
| **Copilot** | ❌ none exposed | shared **git-watcher** | ✅ wired |
| **Codex** | ⚠️ `notify` = turn-end only, not per-edit | shared **git-watcher** (`notify` can trigger a tick) | ✅ wired |

**Why a git-watcher, not per-tool hooks:** only Claude Code exposes a per-edit shell hook.
Cursor and Copilot expose none; Codex's `notify` fires on turn-end, not per edit. They all edit
files on disk in a git repo, so the watcher reads the *actual* changed files from `git status`
and posts them. This is the genuinely tool-agnostic capture — and more honest than pretending
each tool has a bespoke edit hook it doesn't.

> ℹ️ **Limitation (stated, not hidden):** the watcher reports files that are *dirty in the
> working tree*, debounced ~1.5s — not the exact keystroke-level edit Claude's hook sees. Overlap
> detection (the thing that matters) works identically. Recursive `fs.watch` needs macOS or
> Windows; on Linux, drive `watch` from a polling loop.

## Install & connect

Each adapter uses the **same member token** as `convoy-cli` (one per project member — copy it
from your project page).

```bash
# Cursor
node adapters/cursor/bin.mjs connect <token>
node adapters/cursor/bin.mjs watch          # run in your repo; leave it running while you work

# Copilot
node adapters/copilot/bin.mjs connect <token>
node adapters/copilot/bin.mjs watch

# Codex
node adapters/codex/bin.mjs connect <token>
node adapters/codex/bin.mjs watch
```

Token is stored at `~/.convoy/token` (mode 600), shared with `convoy-cli`. Override the endpoint
with `CONVOY_INGEST_URL`, or pass the token inline with `CONVOY_TOKEN=...`.

## Posting memory from an adapter

`watch` posts coordination (edits/idle). To post **team memory** from any tool, POST the v1
contract directly with a `memory` block — see [`docs/ingest-contract.md`](../docs/ingest-contract.md).

## What's shared

All three adapters are 3-line wrappers over `adapters/core.mjs` (`run('<tool>')`). The core does
repo-root detection, `toRepoRelative` path canonicalization, the debounced watcher, and the POST.
Adding a tool = a new `KNOWN_TOOLS` entry (`src/lib/ingest-contract.ts`) + a 3-line bin.
