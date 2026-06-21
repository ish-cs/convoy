import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';
import { resolveMember } from '@/src/lib/mcp/auth';
import { pullTeamContext, setMyStatus } from '@/src/lib/mcp/tools';
import type { MemberRow } from '@/src/types/db';

const handler = createMcpHandler(
  (server) => {
    server.tool(
      'pull_team_context',
      "Read teammates' current sessions, recent activity, and FILE-OVERLAP ALERTS. Call at session start and before editing files. Pass your current git branch and the files you are about to edit to get warned when a teammate is touching the same file.",
      { branch: z.string().nullable().optional(), files: z.array(z.string()).optional() },
      async (args, extra) => {
        const member = extra.authInfo!.extra!.member as MemberRow;
        const res = await pullTeamContext(member, args, new Date());
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      },
    );
    server.tool(
      'set_my_status',
      'Optionally set a short human-readable summary of what you are currently working on, for teammates to see. Files and branch are captured automatically.',
      { summary: z.string() },
      async (args, extra) => {
        const member = extra.authInfo!.extra!.member as MemberRow;
        await setMyStatus(member, args);
        return { content: [{ type: 'text', text: 'summary updated' }] };
      },
    );
  },
  {},
  { disableSse: true }, // stateless streamable-HTTP only — no Redis required
);

const authed = withMcpAuth(
  handler,
  async (_req, token) => {
    const member = await resolveMember(token ?? '');
    if (!member) return undefined; // → 401
    return { token: token!, clientId: member.id, scopes: [], extra: { member } };
  },
  { required: true },
);

export { authed as GET, authed as POST };
