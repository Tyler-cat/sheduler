ALTER TABLE "SchedulingSuggestion"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "committedBy" TEXT,
  ADD COLUMN "queueJobId" TEXT,
  ADD COLUMN "errors" JSONB,
  ADD COLUMN "resultingEventIds" JSONB,
  ADD COLUMN "completedAt" TIMESTAMP(3);
