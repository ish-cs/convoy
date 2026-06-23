import { NextResponse } from 'next/server';
import { resolveMember } from '@/src/lib/mcp/auth';
import { ingestEdit, ingestIdle } from '@/src/lib/ingest';
import { parseContract } from '@/src/lib/ingest-contract';
import { insertMemory } from '@/src/lib/memory-write';
import { getAdmin } from '@/src/lib/supabase/admin';

export const runtime = 'nodejs';

// Tool-agnostic ingest. Accepts the versioned contract v1 ({ v:1, ... source_tool, event?, memory? })
// from any registered tool (Cursor/Copilot/Codex/Claude), and the legacy claude-code CLI shape
// for back-compat. See docs/ingest-contract.md. Downstream is identical regardless of source_tool.
export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const member = await resolveMember(token);
  if (!member) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = parseContract(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const c = parsed.value;

  // Coordination: status + events. Same path the live CLI already drives.
  if (c.event) {
    if (c.event.kind === 'idle') await ingestIdle(member, { session_id: c.sessionId });
    else await ingestEdit(member, { session_id: c.sessionId, branch: c.branch, files: c.files, message: c.event.message });
  }

  // Memory: optional, tool-agnostic. source_tool carries provenance for downstream ranking/UI.
  let memoryId: string | undefined;
  if (c.memory) {
    const r = await insertMemory(getAdmin(), {
      projectId: member.project_id, authorMemberId: member.id,
      authorKind: c.memory.author_kind ?? 'agent', sourceTool: c.sourceTool,
      text: c.memory.text, filePaths: c.memory.file_paths, branch: c.branch, tags: c.memory.tags,
      confidence: c.memory.confidence,
    });
    memoryId = r.id;
  }

  return NextResponse.json({ ok: true, source_tool: c.sourceTool, ...(memoryId ? { memory_id: memoryId } : {}) });
}
