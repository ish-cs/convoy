# Convoy Ingest Contract v1

Convoy is the neutral coordination + memory layer **between** agent tools. Any tool —
Claude Code, Cursor, Copilot, Codex — posts the same shape to `POST /api/ingest` and is
**indistinguishable downstream**: overlap alerts fire, memory recalls, and the live view
renders identically regardless of which tool produced the data. The only trace of origin
is the `source_tool` field, used for provenance and ranking.

## Endpoint

```
POST /api/ingest
Authorization: Bearer <member-token>   # from `convoy-cli connect` (one per project member)
Content-Type: application/json
```

`401` if the token is missing/revoked. `400` with `{ error }` on a malformed contract.

## Contract (v1)

```jsonc
{
  "v": 1,                       // required. Unknown versions are rejected (400).
  "repo": "acme/web",           // optional, informational
  "branch": "feat/login",       // optional, null allowed
  "files": ["src/auth.ts"],     // optional — files touched this tick (repo-relative, see below)
  "session_id": "abc123",       // required — stable per editor session; keys member_status
  "source_tool": "cursor",      // required — one of the registered tools (allowlist)
  "event": {                    // optional — coordination signal
    "kind": "edit",             //   "edit" | "idle"
    "message": "edited a.ts"    //   optional, human-readable
  },
  "memory": {                   // optional — durable team memory
    "text": "auth.ts must use http-only cookies",
    "file_paths": ["src/auth.ts"],  // optional
    "tags": ["security"],            // optional
    "author_kind": "agent",          // optional — "human" | "agent" (default "agent")
    "confidence": 0.8                // optional — 0..1
  }
}
```

A contract MUST carry an `event`, a `memory`, or both (an empty tick is rejected).

### `source_tool` allowlist

`claude-code` · `cursor` · `copilot` · `codex` · `web`

An unregistered value is rejected (400) so a memory's provenance is always trustworthy and
a typo'd adapter fails loudly. Add a tool to `KNOWN_TOOLS` in `src/lib/ingest-contract.ts`
when its adapter ships.

> **Security note (honest):** v1 trusts the adapter to declare its own `source_tool`; a
> valid member token can post under any registered tool. This is acceptable for the current
> trust model (a project member is already authorized to write that project's data). Binding
> `source_tool` to the token at registration time is a future hardening, not a v1 guarantee.

### Repo-relative paths

`files` and `memory.file_paths` MUST be **repo-relative** (e.g. `src/auth.ts`, not
`/Users/you/proj/src/auth.ts`). Adapters compute these with `toRepoRelative` against
`git rev-parse --show-toplevel` so overlap detection works across machines. See
`src/lib/repo-path.ts`.

## Response

```jsonc
{ "ok": true, "source_tool": "cursor", "memory_id": "uuid" }  // memory_id only when a memory was stored
```

## Back-compat (legacy claude-code CLI)

The shipped `convoy-cli` posts the pre-contract shape with **no `v`**:

```jsonc
{ "session_id": "abc", "kind": "edit", "branch": "main", "files": ["a.ts"], "message": "edited a.ts" }
```

The route maps this to a v1 `event` with `source_tool: "claude-code"`. Existing installs keep
working unchanged; new adapters should send v1.

## Versioning

`v` is a hard gate. A future `v: 2` will be parsed by its own schema; v1 clients are never
silently re-interpreted. Bump `v` only for breaking shape changes; additive optional fields
stay on v1.
