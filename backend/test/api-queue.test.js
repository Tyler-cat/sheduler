import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { OrganizationService } from '../src/services/organization-service.js';
import { QueueService } from '../src/services/queue-service.js';
import { MetricsService } from '../src/services/metrics-service.js';

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

describe('queue API', () => {
  let organizationService;
  let queueService;
  let metricsService;
  let app;

  beforeEach(() => {
    let orgCounter = 0;
    let jobCounter = 0;
    organizationService = new OrganizationService({
      idGenerator: () => `org-${++orgCounter}`
    });
    metricsService = new MetricsService();
    queueService = new QueueService({
      idGenerator: () => `job-${++jobCounter}`,
      clock: () => new Date('2024-07-01T00:00:00.000Z'),
      metricsService
    });
    app = createApp({
      port: 0,
      services: { organizationService, queueService, metricsService },
      sessionParser: createSessionParser()
    });
  });

  it('allows administrators to enqueue, inspect, cancel, and retry jobs', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');
    const { port, server } = await startApp(app);
    try {
      let response = await fetch(`http://127.0.0.1:${port}/api/queue/jobs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] } })
        },
        body: JSON.stringify({ organizationId: org.id, type: 'parse', payload: { foo: 'bar' } })
      });
      assert.equal(response.status, 202);
      const enqueuePayload = await response.json();
      const jobId = enqueuePayload.job.id;

      response = await fetch(
        `http://127.0.0.1:${port}/api/queue/jobs?organizationId=${org.id}`,
        {
          headers: {
            'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] } })
          }
        }
      );
      assert.equal(response.status, 200);
      const listPayload = await response.json();
      assert.equal(listPayload.jobs.length, 1);
      let snapshot = metricsService.getSnapshot();
      let backlogGauge = snapshot.gauges.find(
        (entry) => entry.name === 'queue_backlog_total' && entry.labels.type === 'parse'
      );
      assert.equal(backlogGauge?.value, 1);

      response = await fetch(`http://127.0.0.1:${port}/api/queue/jobs/${jobId}/cancel`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] } })
        },
        body: JSON.stringify({ reason: 'duplicate' })
      });
      assert.equal(response.status, 200);
      const cancelledPayload = await response.json();
      assert.equal(cancelledPayload.job.status, 'CANCELLED');
      snapshot = metricsService.getSnapshot();
      backlogGauge = snapshot.gauges.find(
        (entry) => entry.name === 'queue_backlog_total' && entry.labels.type === 'parse'
      );
      assert.equal(backlogGauge?.value, 0);

      response = await fetch(`http://127.0.0.1:${port}/api/queue/jobs/${jobId}/retry`, {
        method: 'POST',
        headers: {
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] } })
        }
      });
      assert.equal(response.status, 200);
      const retriedPayload = await response.json();
      assert.equal(retriedPayload.job.status, 'QUEUED');
      snapshot = metricsService.getSnapshot();
      backlogGauge = snapshot.gauges.find(
        (entry) => entry.name === 'queue_backlog_total' && entry.labels.type === 'parse'
      );
      assert.equal(backlogGauge?.value, 1);

      response = await fetch(`http://127.0.0.1:${port}/api/queue/jobs/${jobId}`, {
        headers: {
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] } })
        }
      });
      assert.equal(response.status, 200);
      const singlePayload = await response.json();
      assert.equal(singlePayload.job.id, jobId);
    } finally {
      await stopApp(server);
    }
  });

  it('blocks staff users from enqueuing jobs', async () => {
    const org = await organizationService.createOrganization({ name: 'Beta', slug: 'beta' });
    const { port, server } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/queue/jobs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'staff-1', globalRole: 'STAFF', orgIds: [org.id] } })
        },
        body: JSON.stringify({ organizationId: org.id, type: 'parse' })
      });
      assert.equal(response.status, 403);
    } finally {
      await stopApp(server);
    }
  });
});
