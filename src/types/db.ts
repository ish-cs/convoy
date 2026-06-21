export interface ProjectRow { id: string; name: string; owner_id: string; created_at: string; }
export interface MemberRow {
  id: string; project_id: string; user_id: string | null; email: string; token: string;
  display_name: string | null; current_summary: string | null; summary_updated_at: string | null;
  revoked_at: string | null; created_at: string;
}
export interface StatusRow {
  member_id: string; session_id: string; project_id: string;
  branch: string | null; files: string[]; ended_at: string | null; updated_at: string;
}
export interface EventRow {
  id: string; project_id: string; member_id: string; session_id: string;
  ts: string; branch: string | null; files: string[]; message: string;
}
