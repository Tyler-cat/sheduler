-- 0004_queue_jobs
CREATE TABLE "QueueJob" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "dedupeKey" TEXT,
  "createdBy" TEXT,
  "queuedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "workerId" TEXT,
  "result" JSONB,
  "lastError" TEXT,
  "errorHistory" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "QueueJob_status_check" CHECK ("status" IN ('QUEUED','RUNNING','COMPLETED','FAILED','DEAD_LETTER','CANCELLED'))
);

CREATE INDEX "QueueJob_org_status_createdAt_idx" ON "QueueJob" ("organizationId", "status", "createdAt" DESC);
CREATE INDEX "QueueJob_dedupeKey_idx" ON "QueueJob" ("dedupeKey");

ALTER TABLE "QueueJob" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "QueueJob_select_policy" ON "QueueJob"
  FOR SELECT
  USING (app_org_ids() @> ARRAY["QueueJob"."organizationId"]);
CREATE POLICY "QueueJob_modify_policy" ON "QueueJob"
  FOR ALL
  USING (app_org_ids() @> ARRAY["QueueJob"."organizationId"])
  WITH CHECK (app_org_ids() @> ARRAY["QueueJob"."organizationId"]);
