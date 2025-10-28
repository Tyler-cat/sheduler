DROP INDEX IF EXISTS "AuditLog_createdAt_idx";
DROP INDEX IF EXISTS "AuditLog_orgId_idx";
DROP TABLE IF EXISTS "AuditLog";

DROP INDEX IF EXISTS "AvailabilityCache_refreshedAt_idx";
DROP INDEX IF EXISTS "AvailabilityCache_orgId_userId_rangeStart_idx";
DROP TABLE IF EXISTS "AvailabilityCache";

DROP TABLE IF EXISTS "SchedulingSuggestion";
DROP TABLE IF EXISTS "EventRecurrenceRule";
DROP TABLE IF EXISTS "EventAssignee";
DROP INDEX IF EXISTS "Event_groupId_idx";
DROP INDEX IF EXISTS "Event_organizationId_start_end_idx";
DROP TABLE IF EXISTS "Event";
DROP TABLE IF EXISTS "GroupMember";
DROP TABLE IF EXISTS "Group";
DROP TABLE IF EXISTS "OrganizationAdmin";
DROP TABLE IF EXISTS "Organization";
DROP TABLE IF EXISTS "User";

DROP TYPE IF EXISTS "Role";
