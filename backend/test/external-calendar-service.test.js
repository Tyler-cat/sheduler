import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ExternalCalendarService } from '../src/services/external-calendar-service.js';
import { QueueService } from '../src/services/queue-service.js';
import { MetricsService } from '../src/services/metrics-service.js';
import { AuditService } from '../src/services/audit-service.js';

describe('ExternalCalendarService', () => {
  let metricsService;
  let auditService;
  let queueService;
  let service;
  let connectionCounter;
  let jobCounter;
  let now;

  beforeEach(() => {
    connectionCounter = 0;
    jobCounter = 0;
    now = new Date('2024-07-01T00:00:00.000Z');
    metricsService = new MetricsService();
    auditService = new AuditService({ metricsService });
    queueService = new QueueService({
      idGenerator: () => `job-${++jobCounter}`,
      clock: () => now,
      metricsService,
      auditService
    });
    service = new ExternalCalendarService({
      idGenerator: () => `conn-${++connectionCounter}`,
      clock: () => now,
      queueService,
      metricsService,
      auditService
    });
  });

  it('creates, lists, and removes connections', () => {
    const created = service.createConnection({
      organizationId: 'org-1',
      userId: 'user-1',
      provider: 'google',
      accountId: 'acct-1',
      displayName: 'Primary Account',
      scopes: ['calendar.read'],
      credentialId: 'cred-1',
      calendars: [{ id: 'cal-1', name: 'Main', primary: true }],
      metadata: { tenant: 'alpha' },
      createdBy: 'admin-1'
    });
    assert.equal(created.id, 'conn-1');
    assert.equal(created.provider, 'GOOGLE');
    assert.equal(created.scopes.length, 1);
    assert.equal(created.calendars.length, 1);

    const listed = service.listConnections({ organizationId: 'org-1' });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, created.id);

    const removed = service.removeConnection('conn-1', { actorId: 'admin-1' });
    assert.equal(removed.id, 'conn-1');
    assert.equal(service.listConnections({ organizationId: 'org-1' }).length, 0);
  });

  it('prevents duplicate provider accounts within an organization', () => {
    service.createConnection({
      organizationId: 'org-1',
      userId: 'user-1',
      provider: 'google',
      accountId: 'acct-1',
      displayName: 'Primary',
      scopes: ['calendar.read']
    });
    assert.throws(() => {
      service.createConnection({
        organizationId: 'org-1',
        userId: 'user-2',
        provider: 'google',
        accountId: 'acct-1',
        displayName: 'Secondary'
      });
    }, /Provider account already linked/);
  });

  it('enqueues sync jobs and records history', async () => {
    const connection = service.createConnection({
      organizationId: 'org-1',
      userId: 'user-1',
      provider: 'google',
      accountId: 'acct-1',
      displayName: 'Primary'
    });
    const result = await service.triggerSync(connection.id, {
      actorId: 'admin-1',
      reason: 'manual-refresh'
    });
    assert.match(result.job.id, /^job-\d+$/);
    assert.equal(result.syncRequest.reason, 'manual-refresh');
    assert.equal(result.connection.syncHistory.length, 1);

    const updated = service.recordSyncResult(connection.id, {
      jobId: 'job-1',
      status: 'completed',
      details: { imported: 5 },
      finishedAt: '2024-07-01T01:00:00.000Z'
    });
    assert.equal(updated.lastSyncStatus, 'COMPLETED');
    assert.equal(updated.syncHistory[0].status, 'COMPLETED');
    assert.equal(updated.syncHistory[0].details.imported, 5);
  });

  it('throws when queue service is missing for sync requests', async () => {
    const standalone = new ExternalCalendarService();
    const created = standalone.createConnection({
      organizationId: 'org-1',
      userId: 'user-1',
      provider: 'google',
      accountId: 'acct-1',
      displayName: 'Primary'
    });
    await assert.rejects(async () => {
      await standalone.triggerSync(created.id);
    }, /Queue service is not configured/);
  });
});
