import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { OrganizationService } from '../src/services/organization-service.js';
import { EventService } from '../src/services/event-service.js';

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

describe('recurrence API', () => {
  let organizationService;
  let eventService;
  let app;
  let org;
  let event;

  beforeEach(async () => {
    let orgCounter = 0;
    let eventCounter = 0;
    organizationService = new OrganizationService({
      idGenerator: () => `org-${++orgCounter}`
    });
    eventService = new EventService({
      idGenerator: () => `event-${++eventCounter}`,
      clock: () => new Date('2024-02-01T00:00:00.000Z')
    });
    org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');
    event = await eventService.createEvent({
      organizationId: org.id,
      title: 'Base shift',
      start: '2024-02-05T09:00:00Z',
      end: '2024-02-05T10:00:00Z'
    });
    app = createApp({
      port: 0,
      services: { organizationService, eventService },
      sessionParser: createSessionParser()
    });
  });

  it('allows admins to manage recurrence rules', async () => {
    const { port } = await startApp(app);
    try {
      const sessionHeader = {
        'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN' } })
      };
      const putResponse = await fetch(`http://127.0.0.1:${port}/api/events/${event.id}/recurrence`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...sessionHeader
        },
        body: JSON.stringify({
          rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
          exdates: ['2024-02-07T09:00:00Z']
        })
      });
      assert.equal(putResponse.status, 200);
      const putPayload = await putResponse.json();
      assert.equal(putPayload.recurrence.rrule, 'FREQ=WEEKLY;BYDAY=MO,WE');

      const getResponse = await fetch(
        `http://127.0.0.1:${port}/api/events/${event.id}/recurrence?start=2024-02-05T00:00:00Z&end=2024-02-20T00:00:00Z`,
        {
          headers: sessionHeader
        }
      );
      assert.equal(getResponse.status, 200);
      const getPayload = await getResponse.json();
      const starts = getPayload.occurrences.occurrences.map((occ) => occ.start);
      assert.deepEqual(starts, [
        '2024-02-05T09:00:00.000Z',
        '2024-02-12T09:00:00.000Z',
        '2024-02-14T09:00:00.000Z',
        '2024-02-19T09:00:00.000Z'
      ]);

      const deleteResponse = await fetch(
        `http://127.0.0.1:${port}/api/events/${event.id}/recurrence`,
        {
          method: 'DELETE',
          headers: sessionHeader
        }
      );
      assert.equal(deleteResponse.status, 204);

      const missingResponse = await fetch(
        `http://127.0.0.1:${port}/api/events/${event.id}/recurrence`,
        { headers: sessionHeader }
      );
      assert.equal(missingResponse.status, 404);
    } finally {
      await stopApp(app);
    }
  });

  it('prevents non-admin users from writing recurrence', async () => {
    const { port } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/events/${event.id}/recurrence`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'staff-1', globalRole: 'STAFF', orgIds: [org.id] } })
        },
        body: JSON.stringify({ rrule: 'FREQ=DAILY' })
      });
      assert.equal(response.status, 403);
    } finally {
      await stopApp(app);
    }
  });
});
