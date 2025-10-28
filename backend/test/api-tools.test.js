import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { OrganizationService } from '../src/services/organization-service.js';
import { EventService } from '../src/services/event-service.js';
import { NotificationService } from '../src/services/notification-service.js';

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

describe('tool API', () => {
  let organizationService;
  let eventService;
  let notificationService;
  let app;

  beforeEach(() => {
    let orgCounter = 0;
    let eventCounter = 0;
    let notificationCounter = 0;
    organizationService = new OrganizationService({
      idGenerator: () => `org-${++orgCounter}`
    });
    eventService = new EventService({
      idGenerator: () => `event-${++eventCounter}`,
      clock: () => new Date('2024-02-01T00:00:00.000Z')
    });
    notificationService = new NotificationService({
      idGenerator: () => `notif-${++notificationCounter}`,
      clock: () => new Date('2024-02-01T00:00:00.000Z')
    });
    app = createApp({
      port: 0,
      services: { organizationService, eventService, notificationService },
      sessionParser: createSessionParser()
    });
  });

  it('allows scoped users to update their personal schedule', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    const { port, server } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/tools/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'staff-1', globalRole: 'STAFF', orgIds: [org.id] } })
        },
        body: JSON.stringify({
          tool: 'update_personal_schedule',
          payload: {
            organizationId: org.id,
            title: 'Focus Time',
            start: '2024-02-02T09:00:00.000Z',
            end: '2024-02-02T10:00:00.000Z'
          }
        })
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.result.event.assigneeIds[0], 'staff-1');
      const events = await eventService.listEvents({ organizationId: org.id });
      assert.equal(events.length, 1);
    } finally {
      await stopApp(server);
    }
  });

  it('rejects tool calls outside of organization scope', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    const { port, server } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/tools/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'staff-1', globalRole: 'STAFF', orgIds: [] } })
        },
        body: JSON.stringify({
          tool: 'update_personal_schedule',
          payload: {
            organizationId: org.id,
            title: 'Focus Time',
            start: '2024-02-02T09:00:00.000Z',
            end: '2024-02-02T10:00:00.000Z'
          }
        })
      });
      assert.equal(response.status, 403);
    } finally {
      await stopApp(server);
    }
  });

  it('delivers notify_admin calls to organization admins', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');
    const { port, server } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/tools/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'staff-1', globalRole: 'STAFF', orgIds: [org.id] } })
        },
        body: JSON.stringify({
          tool: 'notify_admin',
          payload: {
            organizationId: org.id,
            message: 'Model flagged a potential conflict.'
          }
        })
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.result.status, 'DELIVERED');
      const notifications = await notificationService.listByOrganization(org.id);
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].message, 'Model flagged a potential conflict.');
    } finally {
      await stopApp(server);
    }
  });
});
