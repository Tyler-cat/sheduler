DROP POLICY IF EXISTS "QueueJob_modify_policy" ON "QueueJob";
DROP POLICY IF EXISTS "QueueJob_select_policy" ON "QueueJob";
ALTER TABLE "QueueJob" DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS "QueueJob_dedupeKey_idx";
DROP INDEX IF EXISTS "QueueJob_org_status_createdAt_idx";
DROP TABLE IF EXISTS "QueueJob";
