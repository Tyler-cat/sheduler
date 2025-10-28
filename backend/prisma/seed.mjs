import { createPrismaClient, disconnectPrisma } from '../src/db/prisma-client.js';

function deterministicId(suffix) {
  return `seed_${suffix}`;
}

function createSeedRunner({ prisma, now = () => new Date() } = {}) {
  if (!prisma) {
    throw new Error('prisma client is required');
  }
  return async function seed() {
    const timestamp = now();
    const summary = { users: 0, organizations: 0, groups: 0, events: 0, suggestions: 0, availabilityCaches: 0, assignments: 0 };

    const superAdmin = await prisma.user.upsert({
      where: { email: 'superadmin@example.com' },
      update: { updatedAt: timestamp },
      create: {
        id: deterministicId('user_super_admin'),
        email: 'superadmin@example.com',
        passwordHash: 'seeded-super-admin-hash',
        globalRole: 'SUPER_ADMIN',
        capabilities: { featureFlags: ['all'] },
        createdAt: timestamp,
        updatedAt: timestamp
      }
    });
    const admin = await prisma.user.upsert({
      where: { email: 'admin@example.com' },
      update: { updatedAt: timestamp },
      create: {
        id: deterministicId('user_admin'),
        email: 'admin@example.com',
        passwordHash: 'seeded-admin-hash',
        globalRole: 'ADMIN',
        capabilities: { planner: true },
        createdAt: timestamp,
        updatedAt: timestamp
      }
    });
    const staff = await prisma.user.upsert({
      where: { email: 'staff@example.com' },
      update: { updatedAt: timestamp },
      create: {
        id: deterministicId('user_staff'),
        email: 'staff@example.com',
        passwordHash: 'seeded-staff-hash',
        globalRole: 'STAFF',
        createdAt: timestamp,
        updatedAt: timestamp
      }
    });
    summary.users = 3;

    const organization = await prisma.organization.upsert({
      where: { slug: 'alpha' },
      update: {
        name: 'Alpha Org',
        updatedAt: timestamp,
        branding: {
          primaryColor: '#2563eb',
          logoUrl: 'https://example.com/logo-alpha.svg',
          notificationTemplate: 'alpha_template_v1'
        }
      },
      create: {
        id: deterministicId('org_alpha'),
        name: 'Alpha Org',
        slug: 'alpha',
        status: 'active',
        branding: {
          primaryColor: '#2563eb',
          logoUrl: 'https://example.com/logo-alpha.svg',
          notificationTemplate: 'alpha_template_v1'
        },
        createdAt: timestamp,
        updatedAt: timestamp
      }
    });
    summary.organizations = 1;

    await prisma.organizationAdmin.upsert({
      where: { userId_orgId: { userId: admin.id, orgId: organization.id } },
      update: { assignedAt: timestamp },
      create: {
        userId: admin.id,
        orgId: organization.id,
        assignedAt: timestamp
      }
    });
    summary.assignments += 1;

    const group = await prisma.group.upsert({
      where: { orgId_name: { orgId: organization.id, name: 'Day Shift' } },
      update: { updatedAt: timestamp },
      create: {
        id: deterministicId('group_day_shift'),
        name: 'Day Shift',
        orgId: organization.id,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    });
    summary.groups = 1;

    await prisma.groupMember.upsert({
      where: { groupId_userId: { groupId: group.id, userId: staff.id } },
      update: { joinedAt: timestamp },
      create: {
        groupId: group.id,
        userId: staff.id,
        role: 'member',
        joinedAt: timestamp
      }
    });

    const eventStart = new Date(Date.UTC(timestamp.getUTCFullYear(), timestamp.getUTCMonth(), timestamp.getUTCDate(), 9, 0, 0));
    const eventEnd = new Date(eventStart.getTime() + 2 * 60 * 60 * 1000);
    await prisma.event.upsert({
      where: { id: deterministicId('event_alpha_sync') },
      update: {
        title: 'Daily Opening Shift',
        start: eventStart,
        end: eventEnd,
        updatedAt: timestamp
      },
      create: {
        id: deterministicId('event_alpha_sync'),
        organizationId: organization.id,
        groupId: group.id,
        title: 'Daily Opening Shift',
        description: 'Seeded event for integration tests',
        start: eventStart,
        end: eventEnd,
        allDay: false,
        color: '#22c55e',
        visibility: 'private',
        createdBy: admin.id,
        updatedBy: admin.id,
        version: 1,
        metadata: { seed: true },
        createdAt: timestamp,
        updatedAt: timestamp
      }
    });
    await prisma.eventAssignee.upsert({
      where: {
        eventId_userId: {
          eventId: deterministicId('event_alpha_sync'),
          userId: staff.id
        }
      },
      update: { role: 'owner', addedAt: timestamp },
      create: {
        eventId: deterministicId('event_alpha_sync'),
        userId: staff.id,
        role: 'owner',
        addedAt: timestamp
      }
    });
    summary.events = 1;

    await prisma.eventRecurrenceRule.upsert({
      where: { eventId: deterministicId('event_alpha_sync') },
      update: {
        rrule: 'FREQ=DAILY;COUNT=5',
        exdates: null,
        interval: 1,
        metadata: { seeded: true }
      },
      create: {
        eventId: deterministicId('event_alpha_sync'),
        rrule: 'FREQ=DAILY;COUNT=5',
        exdates: null,
        interval: 1,
        metadata: { seeded: true }
      }
    });

    await prisma.schedulingSuggestion.upsert({
      where: { id: deterministicId('suggestion_alpha_day_shift') },
      update: {
        status: 'READY',
        outputPlan: { assignments: ['seeded'] },
        scoreBreakdown: { hard: 0, soft: 1 },
        committedAt: null,
        notes: { review: 'auto' }
      },
      create: {
        id: deterministicId('suggestion_alpha_day_shift'),
        orgId: organization.id,
        solver: 'seed-heuristic',
        status: 'READY',
        inputSnapshot: { groups: [group.id], users: [staff.id] },
        outputPlan: { assignments: ['seeded'] },
        scoreBreakdown: { hard: 0, soft: 1 },
        createdBy: admin.id,
        createdAt: timestamp,
        committedAt: null,
        notes: { review: 'auto' }
      }
    });
    summary.suggestions = 1;

    await prisma.availabilityCache.upsert({
      where: { id: deterministicId('availability_staff_day') },
      update: {
        rangeStart: eventStart,
        rangeEnd: eventEnd,
        freeBusyJson: { free: [[eventEnd.toISOString(), new Date(eventEnd.getTime() + 60 * 60 * 1000).toISOString()]] },
        checksum: 'seeded-checksum',
        refreshedAt: timestamp
      },
      create: {
        id: deterministicId('availability_staff_day'),
        orgId: organization.id,
        userId: staff.id,
        source: 'seed',
        rangeStart: eventStart,
        rangeEnd: eventEnd,
        freeBusyJson: { busy: [[eventStart.toISOString(), eventEnd.toISOString()]] },
        checksum: 'seeded-checksum',
        refreshedAt: timestamp
      }
    });
    summary.availabilityCaches = 1;

    return summary;
  };
}

async function run() {
  const prisma = createPrismaClient();
  try {
    const seed = createSeedRunner({ prisma });
    const summary = await seed();
    console.log('Seed completed', summary);
  } finally {
    await disconnectPrisma(prisma);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { createSeedRunner };
