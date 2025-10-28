DROP POLICY IF EXISTS "AuditLog_write_policy" ON "AuditLog";
DROP POLICY IF EXISTS "AuditLog_select_policy" ON "AuditLog";
ALTER TABLE "AuditLog" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "AvailabilityCache_modify_policy" ON "AvailabilityCache";
DROP POLICY IF EXISTS "AvailabilityCache_select_policy" ON "AvailabilityCache";
ALTER TABLE "AvailabilityCache" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SchedulingSuggestion_modify_policy" ON "SchedulingSuggestion";
DROP POLICY IF EXISTS "SchedulingSuggestion_select_policy" ON "SchedulingSuggestion";
ALTER TABLE "SchedulingSuggestion" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "EventRecurrenceRule_policy" ON "EventRecurrenceRule";
ALTER TABLE "EventRecurrenceRule" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "EventAssignee_modify_policy" ON "EventAssignee";
DROP POLICY IF EXISTS "EventAssignee_select_policy" ON "EventAssignee";
ALTER TABLE "EventAssignee" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Event_delete_policy" ON "Event";
DROP POLICY IF EXISTS "Event_update_policy" ON "Event";
DROP POLICY IF EXISTS "Event_insert_policy" ON "Event";
DROP POLICY IF EXISTS "Event_select_policy" ON "Event";
ALTER TABLE "Event" DISABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS app_org_ids();
