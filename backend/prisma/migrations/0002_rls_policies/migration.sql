-- 0002_rls_policies
CREATE OR REPLACE FUNCTION app_org_ids()
RETURNS text[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  raw text;
BEGIN
  raw := current_setting('app.org_ids', true);
  IF raw IS NULL OR raw = '' THEN
    RETURN ARRAY[]::text[];
  END IF;
  RETURN raw::text[];
END;
$$;

ALTER TABLE "Event" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Event_select_policy" ON "Event"
  FOR SELECT
  USING (app_org_ids() @> ARRAY["Event"."organizationId"]);
CREATE POLICY "Event_insert_policy" ON "Event"
  FOR INSERT
  WITH CHECK (app_org_ids() @> ARRAY["Event"."organizationId"]);
CREATE POLICY "Event_update_policy" ON "Event"
  FOR UPDATE
  USING (app_org_ids() @> ARRAY["Event"."organizationId"])
  WITH CHECK (app_org_ids() @> ARRAY["Event"."organizationId"]);
CREATE POLICY "Event_delete_policy" ON "Event"
  FOR DELETE
  USING (app_org_ids() @> ARRAY["Event"."organizationId"]);

ALTER TABLE "EventAssignee" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "EventAssignee_select_policy" ON "EventAssignee"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "Event"
      WHERE "Event"."id" = "EventAssignee"."eventId"
        AND app_org_ids() @> ARRAY["Event"."organizationId"]
    )
  );
CREATE POLICY "EventAssignee_modify_policy" ON "EventAssignee"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM "Event"
      WHERE "Event"."id" = "EventAssignee"."eventId"
        AND app_org_ids() @> ARRAY["Event"."organizationId"]
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "Event"
      WHERE "Event"."id" = "EventAssignee"."eventId"
        AND app_org_ids() @> ARRAY["Event"."organizationId"]
    )
  );

ALTER TABLE "EventRecurrenceRule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "EventRecurrenceRule_policy" ON "EventRecurrenceRule"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM "Event"
      WHERE "Event"."id" = "EventRecurrenceRule"."eventId"
        AND app_org_ids() @> ARRAY["Event"."organizationId"]
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "Event"
      WHERE "Event"."id" = "EventRecurrenceRule"."eventId"
        AND app_org_ids() @> ARRAY["Event"."organizationId"]
    )
  );

ALTER TABLE "SchedulingSuggestion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SchedulingSuggestion_select_policy" ON "SchedulingSuggestion"
  FOR SELECT
  USING (app_org_ids() @> ARRAY["SchedulingSuggestion"."orgId"]);
CREATE POLICY "SchedulingSuggestion_modify_policy" ON "SchedulingSuggestion"
  FOR ALL
  USING (app_org_ids() @> ARRAY["SchedulingSuggestion"."orgId"])
  WITH CHECK (app_org_ids() @> ARRAY["SchedulingSuggestion"."orgId"]);

ALTER TABLE "AvailabilityCache" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "AvailabilityCache_select_policy" ON "AvailabilityCache"
  FOR SELECT
  USING (app_org_ids() @> ARRAY["AvailabilityCache"."orgId"]);
CREATE POLICY "AvailabilityCache_modify_policy" ON "AvailabilityCache"
  FOR ALL
  USING (app_org_ids() @> ARRAY["AvailabilityCache"."orgId"])
  WITH CHECK (app_org_ids() @> ARRAY["AvailabilityCache"."orgId"]);

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "AuditLog_select_policy" ON "AuditLog"
  FOR SELECT
  USING ("AuditLog"."orgId" IS NULL OR app_org_ids() @> ARRAY["AuditLog"."orgId"]);
CREATE POLICY "AuditLog_write_policy" ON "AuditLog"
  FOR INSERT
  WITH CHECK (TRUE);
