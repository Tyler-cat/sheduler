import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { OrganizationService } from '../src/services/organization-service.js';
import { EventService } from '../src/services/event-service.js';
import { NotificationService } from '../src/services/notification-service.js';
import { ToolService } from '../src/services/tool-service.js';
import { MetricsService } from '../src/services/metrics-service.js';
import { AuditService } from '../src/services/audit-service.js';
import { AiParseJobService, InMemoryParseJobClient, JOB_STATUS } from '../src/services/ai-parse-job-service.js';

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

async function waitForJob(port, jobId, organizationId, session) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/ai/parse-jobs/${jobId}?organizationId=${organizationId}`,
      {
        headers: {
          'x-test-session': session
        }
      }
    );
    if (response.status === 200) {
      const payload = await response.json();
      if (![JOB_STATUS.pending, JOB_STATUS.running].includes(payload.job.status)) {
        return payload.job;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for AI parse job');
}

describe('AI parse job API', () => {
  let organizationService;
  let eventService;
  let notificationService;
  let metricsService;
  let auditService;
  let toolService;
  let aiParseJobService;
  let app;

  beforeEach(() => {
    let orgCounter = 0;
    let eventCounter = 0;
    organizationService = new OrganizationService({
      idGenerator: () => `org-${++orgCounter}`
    });
    eventService = new EventService({
      idGenerator: () => `event-${++eventCounter}`,
      clock: () => new Date('2024-01-01T00:00:00.000Z')
    });
    notificationService = new NotificationService({
      idGenerator: () => `notif-${Date.now()}`,
      clock: () => new Date('2024-01-01T00:00:00.000Z')
    });
    metricsService = new MetricsService();
    auditService = new AuditService({ metricsService });
    toolService = new ToolService({
      organizationService,
      eventService,
      notificationService,
      auditService,
      metricsService
    });
    const client = new InMemoryParseJobClient({
      clock: () => new Date('2024-01-01T00:00:00.000Z'),
      providerHandlers: {
        OPENAI: () => [
          {
            title: 'Calendar Import',
            weekday: 1,
            start: '08:00',
            end: '09:30',
            location: 'Room 9',
            assignees: ['instructor-1'],
            confidence: 0.9,
            toolCalls: [
              {
                type: 'update_personal_schedule',
                payload: {
                  title: 'Imported Session',
                  start: '2024-01-03T08:00:00.000Z',
                  end: '2024-01-03T09:30:00.000Z'
                },
                needsApproval: false
              }
            ]
          }
        ]
      }
    });
    aiParseJobService = new AiParseJobService({
      client,
      toolService,
      organizationService,
      notificationService,
      metricsService,
      auditService
    });
    app = createApp({
      port: 0,
      services: {
        organizationService,
        eventService,
        notificationService,
        toolService,
        metricsService,
        auditService,
        aiParseJobService
      },
      sessionParser: createSessionParser()
    });
  });

  it('requires authentication to submit parse jobs', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');
    const { server, port } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/ai/parse-jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId: org.id,
          provider: 'OPENAI',
          sourceUrl: 'https://example.com/schedule.png'
        })
      });
      assert.equal(response.status, 401);
    } finally {
      await stopApp(server);
    }
  });

  it('allows administrators to submit, inspect, and review parse jobs', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');
    const session = encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] } });
    const { server, port } = await startApp(app);
    try {
      const submit = await fetch(`http://127.0.0.1:${port}/api/ai/parse-jobs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': session
        },
        body: JSON.stringify({
          organizationId: org.id,
          provider: 'OPENAI',
          sourceUrl: 'https://example.com/schedule.png'
        })
      });
      assert.equal(submit.status, 202);
      const submitPayload = await submit.json();
      const jobId = submitPayload.job.id;

      const job = await waitForJob(port, jobId, org.id, session);
      assert.equal(job.status, JOB_STATUS.succeeded);
      const events = await eventService.listEvents({ organizationId: org.id });
      assert.equal(events.length, 1, 'tool execution creates personal schedule event');

      const listResponse = await fetch(
        `http://127.0.0.1:${port}/api/ai/parse-jobs?organizationId=${org.id}`,
        {
          headers: {
            'x-test-session': session
          }
        }
      );
      assert.equal(listResponse.status, 200);
      const listPayload = await listResponse.json();
      assert.equal(listPayload.jobs.length, 1);

      const reviewResponse = await fetch(
        `http://127.0.0.1:${port}/api/ai/parse-jobs/${jobId}/review`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-test-session': session
          },
          body: JSON.stringify({ organizationId: org.id, decision: 'APPROVED' })
        }
      );
      assert.equal(reviewResponse.status, 200);
      const reviewPayload = await reviewResponse.json();
      assert.equal(reviewPayload.job.status, JOB_STATUS.succeeded);
    } finally {
      await stopApp(server);
    }
  });

  it('blocks staff without scope from listing parse jobs', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');
    const session = encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] } });
    const { server, port } = await startApp(app);
    try {
      await fetch(`http://127.0.0.1:${port}/api/ai/parse-jobs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': session
        },
        body: JSON.stringify({
          organizationId: org.id,
          provider: 'OPENAI',
          sourceUrl: 'https://example.com/schedule.png'
        })
      });
      const staffSession = encodeSession({ user: { id: 'staff-1', globalRole: 'STAFF', orgIds: [] } });
      const listResponse = await fetch(
        `http://127.0.0.1:${port}/api/ai/parse-jobs?organizationId=${org.id}`,
        {
          headers: {
            'x-test-session': staffSession
          }
        }
      );
      assert.equal(listResponse.status, 403);
    } finally {
      await stopApp(server);
    }
  });
});
