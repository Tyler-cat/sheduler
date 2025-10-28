import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { OrganizationService } from '../src/services/organization-service.js';
import { QueueService } from '../src/services/queue-service.js';
import { ExternalCalendarService } from '../src/services/external-calendar-service.js';

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

describe('external calendar API', () => {
  let organizationService;
  let queueService;
  let externalCalendarService;
  let app;

  beforeEach(() => {
    let idCounter = 0;
    organizationService = new OrganizationService({ idGenerator: () => `org-${++idCounter}` });
    queueService = new QueueService({ idGenerator: () => `job-${++idCounter}` });
    externalCalendarService = new ExternalCalendarService({
      idGenerator: () => `conn-${++idCounter}`,
      queueService
    });
    app = createApp({
      port: 0,
      services: { organizationService, queueService, externalCalendarService },
      sessionParser: createSessionParser()
    });
  });

  it('allows admins to create, list, sync, and delete connections', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');

    const { server, port } = await startApp(app);
    try {
      let response = await fetch(`http://127.0.0.1:${port}/api/external-calendars`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({
            user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] }
          })
        },
        body: JSON.stringify({
          organizationId: org.id,
          userId: 'admin-1',
          provider: 'google',
          accountId: 'acct-1',
          displayName: 'Primary Calendar',
          scopes: ['calendar.read'],
          calendars: [{ id: 'cal-1', name: 'Main', primary: true }]
        })
      });
      assert.equal(response.status, 201);
      const createdPayload = await response.json();
      const connectionId = createdPayload.connection.id;

      response = await fetch(
        `http://127.0.0.1:${port}/api/external-calendars?organizationId=${org.id}`,
        {
          headers: {
            'x-test-session': encodeSession({
              user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] }
            })
          }
        }
      );
      assert.equal(response.status, 200);
      const listPayload = await response.json();
      assert.equal(listPayload.connections.length, 1);

      response = await fetch(`http://127.0.0.1:${port}/api/external-calendars/${connectionId}/sync`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({
            user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] }
          })
        },
        body: JSON.stringify({ reason: 'manual' })
      });
      assert.equal(response.status, 202);
      const syncPayload = await response.json();
      assert.equal(syncPayload.job.type, 'externalCalendar.sync');

      response = await fetch(`http://127.0.0.1:${port}/api/external-calendars/${connectionId}/calendars`, {
        headers: {
          'x-test-session': encodeSession({
            user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] }
          })
        }
      });
      assert.equal(response.status, 200);
      const calendarsPayload = await response.json();
      assert.equal(calendarsPayload.calendars.length, 1);

      response = await fetch(`http://127.0.0.1:${port}/api/external-calendars/${connectionId}`, {
        headers: {
          'x-test-session': encodeSession({
            user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] }
          })
        }
      });
      assert.equal(response.status, 200);
      const detailPayload = await response.json();
      assert.equal(detailPayload.connection.id, connectionId);

      response = await fetch(`http://127.0.0.1:${port}/api/external-calendars/${connectionId}`, {
        method: 'DELETE',
        headers: {
          'x-test-session': encodeSession({
            user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] }
          })
        }
      });
      assert.equal(response.status, 204);
    } finally {
      await stopApp(server);
    }
  });

  it('blocks staff users from creating connections', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    const { server, port } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/external-calendars`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({
            user: { id: 'staff-1', globalRole: 'STAFF', orgIds: [org.id] }
          })
        },
        body: JSON.stringify({
          organizationId: org.id,
          userId: 'staff-1',
          provider: 'google',
          accountId: 'acct-1',
          displayName: 'Primary'
        })
      });
      assert.equal(response.status, 403);
    } finally {
      await stopApp(server);
    }
  });
});
