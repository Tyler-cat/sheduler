-- 0005_notifications
CREATE TABLE "Notification" (
  "id" TEXT PRIMARY KEY DEFAULT lower(substr(md5(random()::text || clock_timestamp()::text), 1, 24)),
  "organizationId" TEXT NOT NULL,
  "subject" TEXT,
  "message" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'general',
  "metadata" JSONB,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Notification_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "NotificationRecipient" (
  "notificationId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY ("notificationId", "recipientId"),
  CONSTRAINT "NotificationRecipient_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationRecipient_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Notification_organizationId_createdAt_idx" ON "Notification" ("organizationId", "createdAt" DESC);
CREATE INDEX "NotificationRecipient_recipientId_idx" ON "NotificationRecipient" ("recipientId", "readAt");

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Notification_select_policy" ON "Notification"
  FOR SELECT
  USING (app_org_ids() @> ARRAY["Notification"."organizationId"]);
CREATE POLICY "Notification_modify_policy" ON "Notification"
  FOR ALL
  USING (app_org_ids() @> ARRAY["Notification"."organizationId"])
  WITH CHECK (app_org_ids() @> ARRAY["Notification"."organizationId"]);

ALTER TABLE "NotificationRecipient" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "NotificationRecipient_select_policy" ON "NotificationRecipient"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "Notification"
      WHERE "Notification"."id" = "NotificationRecipient"."notificationId"
        AND app_org_ids() @> ARRAY["Notification"."organizationId"]
    )
  );
CREATE POLICY "NotificationRecipient_modify_policy" ON "NotificationRecipient"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM "Notification"
      WHERE "Notification"."id" = "NotificationRecipient"."notificationId"
        AND app_org_ids() @> ARRAY["Notification"."organizationId"]
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "Notification"
      WHERE "Notification"."id" = "NotificationRecipient"."notificationId"
        AND app_org_ids() @> ARRAY["Notification"."organizationId"]
    )
  );
