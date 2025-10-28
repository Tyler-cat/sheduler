import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AiParseJobService, InMemoryParseJobClient, JOB_STATUS } from '../src/services/ai-parse-job-service.js';
import { OrganizationService } from '../src/services/organization-service.js';
import { NotificationService } from '../src/services/notification-service.js';
import { MetricsService } from '../src/services/metrics-service.js';

function createAuditService() {
  const records = [];
  return {
    records,
    record(entry) {
      records.push(entry);
    }
  };
}

async function waitForJob(service, jobId, organizationId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = await service.getJob(jobId, { organizationId });
    if (job && ![JOB_STATUS.pending, JOB_STATUS.running].includes(job.status)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for job to finish');
}

describe('AiParseJobService', () => {
  it('executes tool calls without approval exactly once', async () => {
    const organizationService = new OrganizationService({ idGenerator: () => 'org-1' });
    const notificationService = new NotificationService({ idGenerator: () => 'notif-1' });
    const metricsService = new MetricsService();
    const auditService = createAuditService();
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    const executed = [];
    const toolService = {
      execute(tool, payload) {
        executed.push({ tool, payload });
        return { tool, payload };
      }
    };
    const client = new InMemoryParseJobClient({
      clock: () => new Date('2024-01-01T00:00:00.000Z'),
      providerHandlers: {
        OPENAI: () => [
          {
            title: 'Generated shift',
            weekday: 2,
            start: '09:00',
            end: '10:30',
            location: 'Room 7',
            assignees: ['instructor-1'],
            confidence: 0.92,
            toolCalls: [
              {
                type: 'update_personal_schedule',
                payload: {
                  organizationId: org.id,
                  title: 'Update from AI',
                  start: '2024-01-02T09:00:00.000Z',
                  end: '2024-01-02T10:30:00.000Z'
                },
                needsApproval: false
              }
            ]
          }
        ]
      }
    });
    const service = new AiParseJobService({
      client,
      toolService,
      organizationService,
      notificationService,
      metricsService,
      auditService
    });

    const job = await service.submitJob({
      organizationId: org.id,
      provider: 'OPENAI',
      sourceUrl: 'https://example.com/schedule.png',
      actorId: 'admin-1'
    });

    const resolved = await waitForJob(service, job.id, org.id);
    assert.equal(resolved.status, JOB_STATUS.succeeded);
    assert.equal(executed.length, 1);
    assert.equal(executed[0].tool, 'update_personal_schedule');

    const again = await service.getJob(job.id, { organizationId: org.id });
    assert.equal(again.metadata.executedToolCalls.length, 1);
    assert.equal(executed.length, 1, 'tool executes only once after metadata flag');
    assert.ok(
      auditService.records.some((entry) => entry.action === 'ai.parse_job.tool_execute'),
      'audit record captured tool execution'
    );
  });

  it('notifies admins when tool calls need approval', async () => {
    const organizationService = new OrganizationService({ idGenerator: () => 'org-2' });
    const notificationService = new NotificationService({ idGenerator: () => 'notif-2' });
    const metricsService = new MetricsService();
    const auditService = createAuditService();
    const org = await organizationService.createOrganization({ name: 'Beta', slug: 'beta' });
    await organizationService.addAdmin(org.id, 'admin-9');
    const executed = [];
    const toolService = {
      execute(tool, payload) {
        executed.push({ tool, payload });
        return { tool, payload };
      }
    };
    const client = new InMemoryParseJobClient({
      clock: () => new Date('2024-01-01T00:00:00.000Z'),
      providerHandlers: {
        OPENROUTER: () => [
          {
            title: 'Needs approval',
            weekday: 3,
            start: '13:00',
            end: '14:00',
            location: 'Lab',
            assignees: ['instructor-2'],
            confidence: 0.55,
            toolCalls: [
              {
                type: 'notify_admin',
                payload: { reason: 'manual_review' },
                needsApproval: true
              }
            ]
          }
        ]
      }
    });
    const service = new AiParseJobService({
      client,
      toolService,
      organizationService,
      notificationService,
      metricsService,
      auditService
    });

    const job = await service.submitJob({
      organizationId: org.id,
      provider: 'OPENROUTER',
      sourceUrl: 'https://example.com/manual.png',
      actorId: 'staff-3'
    });

    const resolved = await waitForJob(service, job.id, org.id);
    assert.equal(resolved.status, JOB_STATUS.needsReview);
    assert.equal(executed.length, 0, 'tool should not execute automatically when approval required');

    const notifications = await notificationService.listByOrganization(org.id);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].category, 'ai_tool_approval');
    assert.equal(notifications[0].recipientIds[0], 'admin-9');
    const jobAfter = await service.getJob(job.id, { organizationId: org.id });
    assert.equal(jobAfter.metadata.approvalNotifications.length, 1);
    const notificationsAgain = await notificationService.listByOrganization(org.id);
    assert.equal(notificationsAgain.length, 1, 'approval notification emitted only once');
  });

  it('reviews jobs and updates status', async () => {
    const organizationService = new OrganizationService({ idGenerator: () => 'org-3' });
    const notificationService = new NotificationService({ idGenerator: () => 'notif-3' });
    const metricsService = new MetricsService();
    const auditService = createAuditService();
    const org = await organizationService.createOrganization({ name: 'Gamma', slug: 'gamma' });
    const toolService = {
      execute() {
        return {};
      }
    };
    const client = new InMemoryParseJobClient({
      clock: () => new Date('2024-01-01T00:00:00.000Z'),
      providerHandlers: {
        QWEN_LOCAL: () => [
          {
            title: 'Low confidence shift',
            weekday: 1,
            start: '08:00',
            end: '09:00',
            location: 'Room 3',
            assignees: ['instructor-3'],
            confidence: 0.4,
            toolCalls: []
          }
        ]
      }
    });
    const service = new AiParseJobService({
      client,
      toolService,
      organizationService,
      notificationService,
      metricsService,
      auditService
    });

    const job = await service.submitJob({
      organizationId: org.id,
      provider: 'QWEN_LOCAL',
      sourceUrl: 'https://example.com/review.png',
      actorId: 'admin-8'
    });

    const resolved = await waitForJob(service, job.id, org.id);
    assert.equal(resolved.status, JOB_STATUS.needsReview);
    const reviewed = await service.reviewJob(job.id, 'APPROVED', {
      organizationId: org.id,
      actorId: 'admin-8'
    });
    assert.equal(reviewed.status, JOB_STATUS.succeeded);
    assert.equal(reviewed.metadata.review, 'approved');
    assert.ok(
      auditService.records.some((entry) => entry.action === 'ai.parse_job.review'),
      'review audit record stored'
    );
  });
});
