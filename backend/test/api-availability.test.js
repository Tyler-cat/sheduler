import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { OrganizationService } from '../src/services/organization-service.js';
import { EventService } from '../src/services/event-service.js';
import { AvailabilityService } from '../src/services/availability-service.js';

function encodeSession(session) {
  return Buffer.from(JSON.stringify(session)).toString('base64url');
}

function createSessionParser() {
  return async (req) => {
    const raw = req.headers['x-test-session'];
    if (!raw) {
      return {};
    }
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  };
}

async function startApp(app) {
  return new Promise((resolve) => {
    const server = app.listen(() => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function stopApp(app) {
  return new Promise((resolve) => {
    app.close(() => resolve());
  });
}

describe('availability API', () => {
  let organizationService;
  let eventService;
  let availabilityService;
  let app;

  beforeEach(() => {
    let orgCounter = 0;
    let eventCounter = 0;
    organizationService = new OrganizationService({
      idGenerator: () => `org-${++orgCounter}`
    });
    eventService = new EventService({
      idGenerator: () => `event-${++eventCounter}`,
      clock: () => new Date('2024-05-01T00:00:00.000Z')
    });
    availabilityService = new AvailabilityService({
      eventService,
      clock: () => new Date('2024-05-02T00:00:00.000Z')
    });
    app = createApp({
      port: 0,
      services: { organizationService, eventService, availabilityService },
      sessionParser: createSessionParser()
    });
  });

  it('denies access when user lacks organization scope', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    const { port } = await startApp(app);
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/availability/windows?organizationId=${org.id}&userIds=user-1&start=2024-05-03T09:00:00Z&end=2024-05-03T10:00:00Z`,
        {
          headers: {
            'x-test-session': encodeSession({ user: { id: 'staff-1', globalRole: 'STAFF', orgIds: [] } })
          }
        }
      );
      assert.equal(response.status, 403);
    } finally {
      await stopApp(app);
    }
  });

  it('returns aggregated availability for organization admins', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');
    await eventService.createEvent({
      organizationId: org.id,
      title: 'Standup',
      start: '2024-05-03T09:30:00Z',
      end: '2024-05-03T10:00:00Z',
      assigneeIds: ['user-1']
    });
    await availabilityService.updateCache({
      organizationId: org.id,
      userId: 'user-2',
      rangeStart: '2024-05-03T09:00:00Z',
      rangeEnd: '2024-05-03T11:00:00Z',
      busy: [
        { start: '2024-05-03T10:30:00Z', end: '2024-05-03T11:00:00Z', referenceId: 'ext-1', label: 'External' }
      ]
    });

    const { port } = await startApp(app);
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/availability/windows?organizationId=${org.id}&userIds=user-1&userIds=user-2&start=2024-05-03T09:00:00Z&end=2024-05-03T11:00:00Z&slotMinutes=30`,
        {
          headers: {
            'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] } })
          }
        }
      );
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.ok(Array.isArray(payload.windows));
      assert.equal(payload.windows[0].start, '2024-05-03T09:00:00.000Z');
      assert.ok(Array.isArray(payload.conflicts));
    } finally {
      await stopApp(app);
    }
  });

  it('allows administrators to upsert and inspect availability cache', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');

    const { port, server } = await startApp(app);
    try {
      let response = await fetch(`http://127.0.0.1:${port}/api/availability/cache`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] } })
        },
        body: JSON.stringify({
          organizationId: org.id,
          userId: 'user-1',
          rangeStart: '2024-05-03T09:00:00Z',
          rangeEnd: '2024-05-03T11:00:00Z',
          busy: [{ start: '2024-05-03T10:00:00Z', end: '2024-05-03T10:30:00Z', referenceId: 'ext-1' }]
        })
      });
      assert.equal(response.status, 200);
      const { record } = await response.json();
      assert.equal(record.userId, 'user-1');
      assert.equal(record.busy.length, 1);

      response = await fetch(
        `http://127.0.0.1:${port}/api/availability/cache?organizationId=${org.id}&userIds=user-1`,
        {
          headers: {
            'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] } })
          }
        }
      );
      assert.equal(response.status, 200);
      const listPayload = await response.json();
      assert.equal(listPayload.records.length, 1);

      response = await fetch(`http://127.0.0.1:${port}/api/availability/cache`, {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] } })
        },
        body: JSON.stringify({ organizationId: org.id, userId: 'user-1' })
      });
      assert.equal(response.status, 204);

      response = await fetch(
        `http://127.0.0.1:${port}/api/availability/cache?organizationId=${org.id}&userIds=user-1`,
        {
          headers: {
            'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] } })
          }
        }
      );
      const cleared = await response.json();
      assert.equal(cleared.records.length, 0);
    } finally {
      await stopApp(server);
    }
  });

  it('prevents non-admins from mutating availability cache', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });

    const { port, server } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/availability/cache`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'staff-1', globalRole: 'STAFF', orgIds: [org.id] } })
        },
        body: JSON.stringify({
          organizationId: org.id,
          userId: 'user-1',
          rangeStart: '2024-05-03T09:00:00Z',
          rangeEnd: '2024-05-03T11:00:00Z'
        })
      });
      assert.equal(response.status, 403);
    } finally {
      await stopApp(server);
    }
  });
});
