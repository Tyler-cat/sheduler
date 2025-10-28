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

describe('event API', () => {
  let organizationService;
  let eventService;
  let app;

  beforeEach(() => {
    let orgCounter = 0;
    let eventCounter = 0;
    const orgIds = ['org-1'];
    const eventIds = ['event-1', 'event-2'];
    organizationService = new OrganizationService({
      idGenerator: () => orgIds[orgCounter++] || `org-${orgCounter}`
    });
    eventService = new EventService({
      idGenerator: () => eventIds[eventCounter++] || `event-${eventCounter}`,
      clock: () => new Date('2024-02-01T00:00:00.000Z')
    });
    app = createApp({
      port: 0,
      services: { organizationService, eventService },
      sessionParser: createSessionParser()
    });
  });

  it('requires auth to create events', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');
    const { port } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId: org.id,
          title: 'Shift',
          start: '2024-02-01T09:00:00Z',
          end: '2024-02-01T10:00:00Z'
        })
      });
      assert.equal(response.status, 401);
    } finally {
      await stopApp(app);
    }
  });

  it('prevents users without scope from reading events', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    const { port } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/events?organizationId=${org.id}`, {
        headers: {
          'x-test-session': encodeSession({ user: { id: 'staff-1', globalRole: 'STAFF', orgIds: [] } })
        }
      });
      assert.equal(response.status, 403);
    } finally {
      await stopApp(app);
    }
  });

  it('allows organization admins to create, list, update, and delete events', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');
    const { port } = await startApp(app);
    try {
      const createResponse = await fetch(`http://127.0.0.1:${port}/api/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN' } })
        },
        body: JSON.stringify({
          organizationId: org.id,
          title: 'Shift',
          start: '2024-02-01T09:00:00Z',
          end: '2024-02-01T10:00:00Z',
          assigneeIds: ['user-1']
        })
      });
      assert.equal(createResponse.status, 201);
      const createPayload = await createResponse.json();
      assert.equal(createPayload.event.id, 'event-1');

      const listResponse = await fetch(`http://127.0.0.1:${port}/api/events?organizationId=${org.id}`, {
        headers: {
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] } })
        }
      });
      assert.equal(listResponse.status, 200);
      const listPayload = await listResponse.json();
      assert.equal(listPayload.events.length, 1);

      const updateResponse = await fetch(`http://127.0.0.1:${port}/api/events/${createPayload.event.id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN' } })
        },
        body: JSON.stringify({
          title: 'Updated Shift',
          version: createPayload.event.version,
          start: '2024-02-01T10:00:00Z',
          end: '2024-02-01T11:00:00Z'
        })
      });
      assert.equal(updateResponse.status, 200);
      const updatePayload = await updateResponse.json();
      assert.equal(updatePayload.event.version, 2);

      const deleteResponse = await fetch(`http://127.0.0.1:${port}/api/events/${createPayload.event.id}?version=${updatePayload.event.version}`, {
        method: 'DELETE',
        headers: {
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN' } })
        }
      });
      assert.equal(deleteResponse.status, 204);
    } finally {
      await stopApp(app);
    }
  });

  it('returns conflicts when overlapping assignments occur', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');
    await eventService.createEvent({
      organizationId: org.id,
      title: 'Existing',
      start: '2024-02-01T09:00:00Z',
      end: '2024-02-01T10:00:00Z',
      assigneeIds: ['user-1']
    });
    const { port } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN' } })
        },
        body: JSON.stringify({
          organizationId: org.id,
          title: 'Overlap',
          start: '2024-02-01T09:30:00Z',
          end: '2024-02-01T10:30:00Z',
          assigneeIds: ['user-1']
        })
      });
      assert.equal(response.status, 409);
      const payload = await response.json();
      assert.equal(payload.code, 'EVENT_CONFLICT');
      assert.equal(payload.conflicts.length, 1);
    } finally {
      await stopApp(app);
    }
  });

  it('enforces optimistic locking on update and delete', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');
    const created = await eventService.createEvent({
      organizationId: org.id,
      title: 'Existing',
      start: '2024-02-01T09:00:00Z',
      end: '2024-02-01T10:00:00Z',
      assigneeIds: ['user-1']
    });
    const { port } = await startApp(app);
    try {
      const updateResponse = await fetch(`http://127.0.0.1:${port}/api/events/${created.id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN' } })
        },
        body: JSON.stringify({
          title: 'New Title',
          version: created.version - 1
        })
      });
      assert.equal(updateResponse.status, 409);

      const deleteResponse = await fetch(`http://127.0.0.1:${port}/api/events/${created.id}?version=${created.version - 1}`, {
        method: 'DELETE',
        headers: {
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN' } })
        }
      });
      assert.equal(deleteResponse.status, 409);
    } finally {
      await stopApp(app);
    }
  });
});
