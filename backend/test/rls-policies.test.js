import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '../prisma/migrations');

async function applyMigrations(db) {
  const folders = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    const migrationPath = path.join(migrationsDir, folder, 'migration.sql');
    const sql = await readFile(migrationPath, 'utf8');
    const sanitized = sql.replace(/CREATE\s+EXTENSION[^;]+;/gi, '');
    if (sanitized.trim()) {
      await db.exec(sanitized);
    }
  }
}

function column(row, name) {
  if (Object.prototype.hasOwnProperty.call(row, name)) {
    return row[name];
  }
  const lower = name.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(row, lower)) {
    return row[lower];
  }
  return undefined;
}

test('row level security hides scoped data until org context is provided', async () => {
  const db = new PGlite();
  await applyMigrations(db);
  await db.exec(`
    INSERT INTO "User" ("id", "email", "passwordHash", "globalRole")
    VALUES ('user-1', 'admin@example.com', 'hash', 'SUPER_ADMIN');
  `);
  await db.exec(`
    INSERT INTO "Organization" ("id", "name", "slug")
    VALUES ('org1', 'Org 1', 'org-1'), ('org2', 'Org 2', 'org-2');
  `);
  await db.exec(`
    INSERT INTO "Event" ("id", "organizationId", "title", "start", "end", "createdBy")
    VALUES
      ('evt1', 'org1', 'Event 1', NOW(), NOW() + INTERVAL '1 hour', 'user-1'),
      ('evt2', 'org2', 'Event 2', NOW(), NOW() + INTERVAL '1 hour', 'user-1');
  `);
  await db.exec(`
    INSERT INTO "SchedulingSuggestion" ("id", "orgId", "solver", "inputSnapshot", "createdBy")
    VALUES
      ('sched1', 'org1', 'heuristic', '{}'::jsonb, 'user-1'),
      ('sched2', 'org2', 'heuristic', '{}'::jsonb, 'user-1');
  `);
  await db.exec(`
    INSERT INTO "AvailabilityCache" ("id", "orgId", "userId", "source", "rangeStart", "rangeEnd", "freeBusyJson")
    VALUES
      ('cache1', 'org1', 'user-1', 'google', NOW(), NOW() + INTERVAL '2 hours', '{}'::jsonb),
      ('cache2', 'org2', 'user-1', 'google', NOW(), NOW() + INTERVAL '2 hours', '{}'::jsonb);
  `);
  await db.exec(`
    INSERT INTO "QueueJob" ("id", "organizationId", "type", "status", "payload")
    VALUES
      ('job1', 'org1', 'scheduling.generate', 'QUEUED', '{}'::jsonb),
      ('job2', 'org2', 'externalCalendar.sync', 'QUEUED', '{}'::jsonb);
  `);
  await db.exec(`
    INSERT INTO "Notification" ("id", "organizationId", "message")
    VALUES
      ('notif1', 'org1', 'Check backlog'),
      ('notif2', 'org2', 'Review schedule');
  `);
  await db.exec(`
    INSERT INTO "NotificationRecipient" ("notificationId", "recipientId")
    VALUES
      ('notif1', 'user-1'),
      ('notif2', 'user-1');
  `);
  await db.exec(`
    INSERT INTO "AuditLog" ("id", "actorId", "orgId", "action", "subjectType")
    VALUES
      ('audit-global', 'user-1', NULL, 'GLOBAL_EVENT', 'SYSTEM'),
      ('audit-org1', 'user-1', 'org1', 'CREATE_EVENT', 'Event'),
      ('audit-org2', 'user-1', 'org2', 'CREATE_EVENT', 'Event');
  `);
  await db.exec('CREATE ROLE app_user;');
  await db.exec('GRANT USAGE ON SCHEMA public TO app_user;');
  await db.exec('GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_user;');

  await db.exec('SET row_security = on;');
  await db.exec('SET SESSION AUTHORIZATION app_user;');

  let result = await db.query('SELECT "id" FROM "Event" ORDER BY "id"');
  assert.equal(result.rows.length, 0, 'events should be hidden when no org scope is provided');

  result = await db.query('SELECT "id" FROM "SchedulingSuggestion" ORDER BY "id"');
  assert.equal(result.rows.length, 0, 'scheduling suggestions should be hidden without org scope');

  result = await db.query('SELECT "id" FROM "AvailabilityCache" ORDER BY "id"');
  assert.equal(result.rows.length, 0, 'availability caches should be hidden without org scope');

  result = await db.query('SELECT "id" FROM "QueueJob" ORDER BY "id"');
  assert.equal(result.rows.length, 0, 'queue jobs should be hidden without org scope');

  result = await db.query('SELECT "id" FROM "Notification" ORDER BY "id"');
  assert.equal(result.rows.length, 0, 'notifications should be hidden without org scope');

  result = await db.query('SELECT "notificationId" FROM "NotificationRecipient" ORDER BY "notificationId"');
  assert.equal(result.rows.length, 0, 'notification recipients should be hidden without org scope');

  result = await db.query('SELECT "orgId" FROM "AuditLog" ORDER BY "orgId" NULLS FIRST, "id"');
  assert.deepEqual(
    result.rows.map((row) => column(row, 'orgId')),
    [null],
    'only global audit log entries should be visible without org scope'
  );

  await db.exec("SET app.org_ids = '{org1}'");
  result = await db.query('SELECT "organizationId" FROM "Event" ORDER BY "organizationId"');
  assert.deepEqual(result.rows.map((row) => column(row, 'organizationId')), ['org1']);

  result = await db.query('SELECT "orgId" FROM "SchedulingSuggestion" ORDER BY "orgId"');
  assert.deepEqual(result.rows.map((row) => column(row, 'orgId')), ['org1']);

  result = await db.query('SELECT "orgId" FROM "AvailabilityCache" ORDER BY "orgId"');
  assert.deepEqual(result.rows.map((row) => column(row, 'orgId')), ['org1']);

  result = await db.query('SELECT "organizationId" FROM "QueueJob" ORDER BY "organizationId"');
  assert.deepEqual(result.rows.map((row) => column(row, 'organizationId')), ['org1']);

  result = await db.query('SELECT "organizationId" FROM "Notification" ORDER BY "organizationId"');
  assert.deepEqual(result.rows.map((row) => column(row, 'organizationId')), ['org1']);

  result = await db.query('SELECT "notificationId" FROM "NotificationRecipient" ORDER BY "notificationId"');
  assert.deepEqual(result.rows.map((row) => column(row, 'notificationId')), ['notif1']);

  await db.exec('RESET app.org_ids;');
  await db.exec("SET app.org_ids = '{org2}'");
  result = await db.query('SELECT "organizationId" FROM "Event" ORDER BY "organizationId"');
  assert.deepEqual(result.rows.map((row) => column(row, 'organizationId')), ['org2']);

  result = await db.query('SELECT "orgId" FROM "AuditLog" ORDER BY "orgId" NULLS FIRST, "id"');
  assert.deepEqual(
    result.rows.map((row) => column(row, 'orgId')),
    [null, 'org2'],
    'scoped audit logs should include null and matching org entries'
  );

  result = await db.query('SELECT "organizationId" FROM "QueueJob" ORDER BY "organizationId"');
  assert.deepEqual(result.rows.map((row) => column(row, 'organizationId')), ['org2']);

  result = await db.query('SELECT "organizationId" FROM "Notification" ORDER BY "organizationId"');
  assert.deepEqual(result.rows.map((row) => column(row, 'organizationId')), ['org2']);

  result = await db.query('SELECT "notificationId" FROM "NotificationRecipient" ORDER BY "notificationId"');
  assert.deepEqual(result.rows.map((row) => column(row, 'notificationId')), ['notif2']);
});
