import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { OrganizationService } from '../src/services/organization-service.js';
import { EventService } from '../src/services/event-service.js';
import { MetricsService } from '../src/services/metrics-service.js';
import { AuditService } from '../src/services/audit-service.js';

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

describe('observability endpoints', () => {
  let organizationService;
  let eventService;
  let metricsService;
  let auditService;
  let app;

  beforeEach(() => {
    let orgCounter = 0;
    let eventCounter = 0;
    organizationService = new OrganizationService({
      idGenerator: () => `org-${++orgCounter}`
    });
    eventService = new EventService({
      idGenerator: () => `event-${++eventCounter}`,
      clock: () => new Date('2024-04-01T00:00:00.000Z')
    });
    metricsService = new MetricsService();
    auditService = new AuditService({
      metricsService,
      clock: () => new Date('2024-04-01T00:00:00.000Z')
    });
    app = createApp({
      port: 0,
      services: { organizationService, eventService, metricsService, auditService },
      sessionParser: createSessionParser()
    });
  });

  it('exposes metrics and audit records for administrators', async () => {
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
          start: '2024-04-01T09:00:00Z',
          end: '2024-04-01T10:00:00Z'
        })
      });
      assert.equal(createResponse.status, 201);

      const metricsResponse = await fetch(`http://127.0.0.1:${port}/metrics`);
      assert.equal(metricsResponse.status, 200);
      const metricsText = await metricsResponse.text();
      assert.match(metricsText, /event_changes_total\{action="create"} 1/);

      const auditResponse = await fetch(
        `http://127.0.0.1:${port}/api/audit?organizationId=${org.id}`,
        {
          headers: {
            'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] } })
          }
        }
      );
      assert.equal(auditResponse.status, 200);
      const auditPayload = await auditResponse.json();
      assert.ok(Array.isArray(auditPayload.entries));
      assert.ok(auditPayload.entries.some((entry) => entry.action === 'event.create'));
    } finally {
      await stopApp(app);
    }
  });
});
