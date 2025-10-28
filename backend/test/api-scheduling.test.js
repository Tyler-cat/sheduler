import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { OrganizationService } from '../src/services/organization-service.js';
import { EventService } from '../src/services/event-service.js';
import { AvailabilityService } from '../src/services/availability-service.js';
import { SchedulingService } from '../src/services/scheduling-service.js';

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

async function waitForStatus(port, suggestionId, expected) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/scheduling/suggestions/${suggestionId}`, {
      headers: {
        'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: ['org-1'] } })
      }
    });
    if (response.status === 200) {
      const payload = await response.json();
      if (payload.suggestion.status === expected) {
        return payload.suggestion;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${expected}`);
}

describe('scheduling API', () => {
  let organizationService;
  let eventService;
  let availabilityService;
  let schedulingService;
  let app;

  beforeEach(() => {
    let orgCounter = 0;
    let eventCounter = 0;
    let suggestionCounter = 0;
    organizationService = new OrganizationService({
      idGenerator: () => `org-${++orgCounter}`
    });
    eventService = new EventService({
      idGenerator: () => `event-${++eventCounter}`,
      clock: () => new Date('2024-06-01T00:00:00.000Z')
    });
    availabilityService = new AvailabilityService({
      eventService,
      clock: () => new Date('2024-06-02T00:00:00.000Z')
    });
    schedulingService = new SchedulingService({
      availabilityService,
      eventService,
      clock: () => new Date('2024-06-02T00:00:00.000Z'),
      idGenerator: () => `suggestion-${++suggestionCounter}`
    });
    app = createApp({
      port: 0,
      services: { organizationService, eventService, availabilityService, schedulingService },
      sessionParser: createSessionParser()
    });
  });

  it('blocks scheduling runs for non-admins', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    const { port } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/scheduling/run`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'staff-1', globalRole: 'STAFF', orgIds: [org.id] } })
        },
        body: JSON.stringify({
          organizationId: org.id,
          userIds: ['user-1'],
          rangeStart: '2024-06-03T09:00:00Z',
          rangeEnd: '2024-06-03T10:00:00Z',
          durationMinutes: 30
        })
      });
      assert.equal(response.status, 403);
    } finally {
      await stopApp(app);
    }
  });

  it('runs scheduling, exposes status, and commits events', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');

    const { port } = await startApp(app);
    try {
      const runResponse = await fetch(`http://127.0.0.1:${port}/api/scheduling/run`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] } })
        },
        body: JSON.stringify({
          organizationId: org.id,
          userIds: ['user-1', 'user-2'],
          rangeStart: '2024-06-03T09:00:00Z',
          rangeEnd: '2024-06-03T12:00:00Z',
          durationMinutes: 60,
          title: 'Coverage'
        })
      });
      assert.equal(runResponse.status, 202);
      const runPayload = await runResponse.json();
      const suggestionId = runPayload.suggestion.id;

      const ready = await waitForStatus(port, suggestionId, 'READY');
      assert.equal(ready.outputPlan.events.length, 1);

      const commitResponse = await fetch(`http://127.0.0.1:${port}/api/scheduling/suggestions/${suggestionId}/commit`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] } })
        },
        body: JSON.stringify({})
      });
      assert.equal(commitResponse.status, 200);
      const commitPayload = await commitResponse.json();
      assert.equal(commitPayload.events.length, 1);
      const events = await eventService.listEvents({ organizationId: org.id });
      assert.equal(events.length, 1);
      assert.equal(events[0].title, 'Coverage');
    } finally {
      await stopApp(app);
    }
  });

  it('lists scheduling suggestions for an organization', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');

    const { port } = await startApp(app);
    try {
      const runResponse = await fetch(`http://127.0.0.1:${port}/api/scheduling/run`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] } })
        },
        body: JSON.stringify({
          organizationId: org.id,
          userIds: ['user-1'],
          rangeStart: '2024-06-03T09:00:00Z',
          rangeEnd: '2024-06-03T10:00:00Z',
          durationMinutes: 60
        })
      });
      assert.equal(runResponse.status, 202);
      const runPayload = await runResponse.json();
      const suggestionId = runPayload.suggestion.id;
      await waitForStatus(port, suggestionId, 'READY');

      const listResponse = await fetch(
        `http://127.0.0.1:${port}/api/scheduling/suggestions?organizationId=${org.id}`,
        {
          headers: {
            'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] } })
          }
        }
      );
      assert.equal(listResponse.status, 200);
      const listPayload = await listResponse.json();
      assert.ok(Array.isArray(listPayload.suggestions));
      assert.equal(listPayload.suggestions.length, 1);
      assert.equal(listPayload.suggestions[0].id, suggestionId);
    } finally {
      await stopApp(app);
    }
  });
});
