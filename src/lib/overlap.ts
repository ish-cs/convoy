import { OVERLAP_WINDOW_MINUTES } from './constants';
export interface MemberSnapshot { memberId: string; displayName: string; branch: string | null; files: string[]; lastActivityAt: string; }
export interface OverlapAlert { memberId: string; displayName: string; branch: string | null; file: string; lastActivityAt: string; }
export function normalizePath(p: string): string {
  return p.trim().replace(/^\.\//, '').replace(/\/+/g, '/');
}
export function computeOverlap(
  me: { files: string[]; branch: string | null },
  others: MemberSnapshot[],
  now: Date,
  windowMinutes: number = OVERLAP_WINDOW_MINUTES,
): OverlapAlert[] {
  const cutoff = now.getTime() - windowMinutes * 60_000;
  const myFiles = new Set(me.files.map(normalizePath));
  const alerts: OverlapAlert[] = [];
  for (const o of others) {
    if (new Date(o.lastActivityAt).getTime() < cutoff) continue;
    for (const f of o.files) {
      if (myFiles.has(normalizePath(f))) {
        alerts.push({ memberId: o.memberId, displayName: o.displayName, branch: o.branch, file: f, lastActivityAt: o.lastActivityAt });
      }
    }
  }
  return alerts;
}
