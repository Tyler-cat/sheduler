import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedRunner } from '../prisma/seed.mjs';
import { createMockPrisma } from './helpers/mock-prisma.js';

async function runSeed(prisma) {
  const seed = createSeedRunner({ prisma, now: () => new Date('2024-01-15T08:00:00Z') });
  return seed();
}

test('seed runner populates baseline domain data', async () => {
  const prisma = createMockPrisma();

  const summary = await runSeed(prisma);
  assert.equal(summary.organizations, 1);
  assert.equal(summary.users, 3);
  assert.equal(summary.events, 1);

  const organizations = await prisma.organization.findMany({ include: { admins: true, groups: true } });
  assert.equal(organizations.length, 1);
  assert.equal(organizations[0].admins.length, 1);
  assert.equal(organizations[0].groups.length, 1);

  const event = await prisma.event.findUnique({
    where: { id: 'seed_event_alpha_sync' },
    include: { assignees: true, recurrence: true }
  });
  assert.ok(event, 'event should exist');
  assert.equal(event.assignees.length, 1);
  assert.ok(event.recurrence, 'recurrence rule should exist');

  const suggestion = await prisma.schedulingSuggestion.findUnique({ where: { id: 'seed_suggestion_alpha_day_shift' } });
  assert.equal(suggestion.status, 'READY');

  const availability = await prisma.availabilityCache.findMany();
  assert.equal(availability.length, 1);
});

test('seed runner is idempotent', async () => {
  const prisma = createMockPrisma();

  await runSeed(prisma);
  await runSeed(prisma);

  const userCount = await prisma.user.count();
  assert.equal(userCount, 3);

  const adminAssignments = await prisma.organizationAdmin.count();
  assert.equal(adminAssignments, 1);

  const eventAssignees = await prisma.eventAssignee.count();
  assert.equal(eventAssignees, 1);
});
