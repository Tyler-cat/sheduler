-- 0005_notifications down
DROP POLICY IF EXISTS "NotificationRecipient_modify_policy" ON "NotificationRecipient";
DROP POLICY IF EXISTS "NotificationRecipient_select_policy" ON "NotificationRecipient";
ALTER TABLE "NotificationRecipient" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Notification_modify_policy" ON "Notification";
DROP POLICY IF EXISTS "Notification_select_policy" ON "Notification";
ALTER TABLE "Notification" DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS "NotificationRecipient_recipientId_idx";
DROP INDEX IF EXISTS "Notification_organizationId_createdAt_idx";
DROP TABLE IF EXISTS "NotificationRecipient";
DROP TABLE IF EXISTS "Notification";
