ALTER TABLE "SchedulingSuggestion"
  DROP COLUMN IF EXISTS "completedAt",
  DROP COLUMN IF EXISTS "resultingEventIds",
  DROP COLUMN IF EXISTS "errors",
  DROP COLUMN IF EXISTS "queueJobId",
  DROP COLUMN IF EXISTS "committedBy",
  DROP COLUMN IF EXISTS "updatedAt";
