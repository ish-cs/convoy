// Versioned, tool-agnostic ingest contract (v1).
//
// Convoy is the neutral layer between agent tools: Claude Code, Cursor, Copilot,
// Codex all post the SAME shape here and are indistinguishable downstream (overlap
// fires, memory recalls, regardless of origin). This module is the pure parse/validate
// seam — the route just authenticates, calls parseContract, and applies the result.
//
// Back-compat: the shipped convoy-cli posts the legacy shape
// `{ session_id, kind, branch, files, message }` with no `v`. We map that to a v1
// contract with source_tool='claude-code' so the live CLI keeps working unchanged.
import { z } from 'zod';

// Tools allowed to declare themselves. An allowlist (not a free string) so a memory's
// provenance is trustworthy downstream and a typo'd adapter fails loudly instead of
// silently creating a phantom source_tool. Add a tool here when its adapter ships.
export const KNOWN_TOOLS = ['claude-code', 'cursor', 'copilot', 'codex', 'web'] as const;
export type KnownTool = (typeof KNOWN_TOOLS)[number];

const MemoryInput = z.object({
  text: z.string().min(1),
  file_paths: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  author_kind: z.enum(['human', 'agent']).optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type MemoryInput = z.infer<typeof MemoryInput>;

const EventInput = z.object({
  kind: z.enum(['edit', 'idle']),
  message: z.string().optional(),
});

const ContractV1 = z.object({
  v: z.literal(1),
  repo: z.string().optional(),
  branch: z.string().nullable().optional(),
  files: z.array(z.string()).optional(),
  session_id: z.string().min(1),
  source_tool: z.enum(KNOWN_TOOLS),
  event: EventInput.optional(),
  memory: MemoryInput.optional(),
});

const LegacyBody = z.object({
  session_id: z.string().min(1),
  kind: z.enum(['edit', 'idle']),
  branch: z.string().nullable().optional(),
  files: z.array(z.string()).optional(),
  message: z.string().optional(),
});

// Normalized shape the route applies. Both v1 and legacy collapse to this.
export interface NormalizedIngest {
  sourceTool: KnownTool;
  sessionId: string;
  branch: string | null;
  files: string[];
  event: { kind: 'edit' | 'idle'; message?: string } | null;
  memory: MemoryInput | null;
}

export type ParseResult =
  | { ok: true; value: NormalizedIngest }
  | { ok: false; status: 400; error: string };

export function parseContract(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, status: 400, error: 'body must be a JSON object' };
  }
  const v = (raw as { v?: unknown }).v;

  // Versioned path: anyone sending `v` opts into the contract. Reject unknown versions
  // loudly so a future v2 client never gets silently mis-parsed as v1.
  if (v !== undefined) {
    if (v !== 1) {
      return { ok: false, status: 400, error: `unsupported contract version: ${String(v)}` };
    }
    const p = ContractV1.safeParse(raw);
    if (!p.success) return { ok: false, status: 400, error: p.error.issues[0]?.message ?? 'invalid contract' };
    const c = p.data;
    if (!c.event && !c.memory) {
      return { ok: false, status: 400, error: 'contract must carry an event, a memory, or both' };
    }
    return {
      ok: true,
      value: {
        sourceTool: c.source_tool,
        sessionId: c.session_id,
        branch: c.branch ?? null,
        files: c.files ?? [],
        event: c.event ?? null,
        memory: c.memory ?? null,
      },
    };
  }

  // Legacy path: the shipped claude-code CLI. Map verbatim to a v1 event.
  const p = LegacyBody.safeParse(raw);
  if (!p.success) return { ok: false, status: 400, error: p.error.issues[0]?.message ?? 'bad request' };
  const b = p.data;
  return {
    ok: true,
    value: {
      sourceTool: 'claude-code',
      sessionId: b.session_id,
      branch: b.branch ?? null,
      files: b.files ?? [],
      event: { kind: b.kind, message: b.message },
      memory: null,
    },
  };
}
