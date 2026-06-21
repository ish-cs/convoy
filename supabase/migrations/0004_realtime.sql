-- Enable Supabase Realtime for the live project view.
-- RLS still governs delivery: only project members receive these changes
-- (see member_status status_read / events events_read policies in 0002_rls.sql).
alter publication supabase_realtime add table member_status;
alter publication supabase_realtime add table events;
