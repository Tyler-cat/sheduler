import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { OrganizationService } from '../src/services/organization-service.js';
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

describe('notification API', () => {
  let organizationService;
  let notificationService;
  let app;

  beforeEach(() => {
    let orgCounter = 0;
    let notificationCounter = 0;
    organizationService = new OrganizationService({
      idGenerator: () => `org-${++orgCounter}`
    });
    notificationService = new NotificationService({
      idGenerator: () => `notif-${++notificationCounter}`,
      clock: () => new Date('2024-08-01T08:00:00.000Z')
    });
    app = createApp({
      port: 0,
      services: { organizationService, notificationService },
      sessionParser: createSessionParser()
    });
  });

  it('allows administrators to broadcast and review notifications', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');
    const { port, server } = await startApp(app);
    try {
      let response = await fetch(`http://127.0.0.1:${port}/api/notifications`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({
            user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] }
          })
        },
        body: JSON.stringify({
          organizationId: org.id,
          message: 'Queue job failed',
          subject: 'Action required',
          category: 'alert',
          recipientIds: ['admin-1', 'staff-1']
        })
      });
      assert.equal(response.status, 201);
      const createdPayload = await response.json();
      const notificationId = createdPayload.notification.id;
      assert.equal(createdPayload.notification.category, 'alert');
      assert.deepEqual(createdPayload.notification.recipientIds.sort(), ['admin-1', 'staff-1'].sort());

      response = await fetch(
        `http://127.0.0.1:${port}/api/notifications?organizationId=${org.id}`,
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
      assert.equal(listPayload.notifications.length, 1);
      assert.deepEqual(listPayload.notifications[0].readReceipts, {});

      response = await fetch(`http://127.0.0.1:${port}/api/notifications`, {
        headers: {
          'x-test-session': encodeSession({
            user: { id: 'staff-1', globalRole: 'STAFF', orgIds: [org.id] }
          })
        }
      });
      assert.equal(response.status, 200);
      const recipientPayload = await response.json();
      assert.equal(recipientPayload.notifications.length, 1);
      assert.equal(recipientPayload.notifications[0].readAt, null);
      assert.equal(recipientPayload.notifications[0].subject, 'Action required');

      response = await fetch(`http://127.0.0.1:${port}/api/notifications/${notificationId}/read`, {
        method: 'POST',
        headers: {
          'x-test-session': encodeSession({
            user: { id: 'staff-1', globalRole: 'STAFF', orgIds: [org.id] }
          })
        }
      });
      assert.equal(response.status, 200);
      const readPayload = await response.json();
      assert.equal(readPayload.notification.readAt, '2024-08-01T08:00:00.000Z');

      const refreshed = await fetch(
        `http://127.0.0.1:${port}/api/notifications?organizationId=${org.id}`,
        {
          headers: {
            'x-test-session': encodeSession({
              user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] }
            })
          }
        }
      );
      const refreshedPayload = await refreshed.json();
      assert.deepEqual(refreshedPayload.notifications[0].readReceipts, {
        'staff-1': '2024-08-01T08:00:00.000Z'
      });
    } finally {
      await stopApp(server);
    }
  });

  it('prevents non-admins from creating notifications for the organization', async () => {
    const org = await organizationService.createOrganization({ name: 'Beta', slug: 'beta' });
    const { port, server } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/notifications`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({
            user: { id: 'staff-1', globalRole: 'STAFF', orgIds: [org.id] }
          })
        },
        body: JSON.stringify({
          organizationId: org.id,
          message: 'Hello team'
        })
      });
      assert.equal(response.status, 403);
    } finally {
      await stopApp(server);
    }
  });
});
