-- 0001_init migration
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'STAFF');

CREATE TABLE "User" (
  "id" TEXT PRIMARY KEY DEFAULT lower(substr(md5(random()::text || clock_timestamp()::text), 1, 24)),
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "globalRole" "Role" NOT NULL DEFAULT 'STAFF',
  "capabilities" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Organization" (
  "id" TEXT PRIMARY KEY DEFAULT lower(substr(md5(random()::text || clock_timestamp()::text), 1, 24)),
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'active',
  "branding" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "OrganizationAdmin" (
  "userId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationAdmin_pkey" PRIMARY KEY ("userId", "orgId"),
  CONSTRAINT "OrganizationAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrganizationAdmin_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Group" (
  "id" TEXT PRIMARY KEY DEFAULT lower(substr(md5(random()::text || clock_timestamp()::text), 1, 24)),
  "name" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Group_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Group_orgId_name_key" UNIQUE ("orgId", "name")
);

CREATE TABLE "GroupMember" (
  "groupId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("groupId", "userId"),
  CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Event" (
  "id" TEXT PRIMARY KEY DEFAULT lower(substr(md5(random()::text || clock_timestamp()::text), 1, 24)),
  "organizationId" TEXT NOT NULL,
  "groupId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "start" TIMESTAMP(3) NOT NULL,
  "end" TIMESTAMP(3) NOT NULL,
  "allDay" BOOLEAN NOT NULL DEFAULT false,
  "color" TEXT,
  "visibility" TEXT NOT NULL DEFAULT 'private',
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "repeatInterval" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Event_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Event_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Event_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Event_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Event_organizationId_start_end_idx" ON "Event" ("organizationId", "start", "end");
CREATE INDEX "Event_groupId_idx" ON "Event" ("groupId");

CREATE TABLE "EventAssignee" (
  "eventId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'participant',
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventAssignee_pkey" PRIMARY KEY ("eventId", "userId"),
  CONSTRAINT "EventAssignee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EventAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "EventRecurrenceRule" (
  "eventId" TEXT PRIMARY KEY,
  "rrule" TEXT NOT NULL,
  "exdates" TEXT,
  "interval" INTEGER,
  "metadata" JSONB,
  CONSTRAINT "EventRecurrenceRule_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SchedulingSuggestion" (
  "id" TEXT PRIMARY KEY DEFAULT lower(substr(md5(random()::text || clock_timestamp()::text), 1, 24)),
  "orgId" TEXT NOT NULL,
  "solver" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "inputSnapshot" JSONB NOT NULL,
  "outputPlan" JSONB,
  "scoreBreakdown" JSONB,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "committedAt" TIMESTAMP(3),
  "notes" JSONB,
  CONSTRAINT "SchedulingSuggestion_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AvailabilityCache" (
  "id" TEXT PRIMARY KEY DEFAULT lower(substr(md5(random()::text || clock_timestamp()::text), 1, 24)),
  "orgId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "rangeStart" TIMESTAMP(3) NOT NULL,
  "rangeEnd" TIMESTAMP(3) NOT NULL,
  "freeBusyJson" JSONB NOT NULL,
  "checksum" TEXT,
  "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AvailabilityCache_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AvailabilityCache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AvailabilityCache_orgId_userId_rangeStart_idx" ON "AvailabilityCache" ("orgId", "userId", "rangeStart");
CREATE INDEX "AvailabilityCache_refreshedAt_idx" ON "AvailabilityCache" ("refreshedAt");

CREATE TABLE "AuditLog" (
  "id" TEXT PRIMARY KEY DEFAULT lower(substr(md5(random()::text || clock_timestamp()::text), 1, 24)),
  "actorId" TEXT NOT NULL,
  "orgId" TEXT,
  "action" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT,
  "before" JSONB,
  "after" JSONB,
  "context" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AuditLog_orgId_idx" ON "AuditLog" ("orgId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog" ("createdAt");
