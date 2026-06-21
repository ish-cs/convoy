import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';
import { resolveMember } from '@/src/lib/mcp/auth';
import { pullTeamContext, setMyStatus, remember, recall } from '@/src/lib/mcp/tools';
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
    server.tool(
      'remember',
      'Save a durable team memory (a decision, convention, gotcha, or fact) tied to files/branch so teammates and future sessions recall it when they touch the same code. Do NOT store secrets. Use for things worth keeping beyond this session.',
      { text: z.string(), file_paths: z.array(z.string()).optional(), branch: z.string().nullable().optional(), tags: z.array(z.string()).optional() },
      async (args, extra) => {
        const member = extra.authInfo!.extra!.member as MemberRow;
        try {
          const { id } = await remember(member, args);
          return { content: [{ type: 'text', text: `remembered (${id})` }] };
        } catch (e) {
          // additive: never throw out of the handler
          return { content: [{ type: 'text', text: `not saved: ${(e as Error).message}` }] };
        }
      },
    );
    server.tool(
      'recall',
      'Search this project\'s team memory (decisions, conventions, gotchas) by keywords. Call when you need prior context about an area of the code. Returns the most relevant saved memories.',
      { query: z.string().optional() },
      async (args, extra) => {
        const member = extra.authInfo!.extra!.member as MemberRow;
        const rows = await recall(member, args);
        return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
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
