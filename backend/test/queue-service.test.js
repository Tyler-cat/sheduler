import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { QueueService } from '../src/services/queue-service.js';

describe('QueueService', () => {
  let now;
  let queueService;
  let counter;
  let auditEntries;

  beforeEach(() => {
    now = new Date('2024-01-01T00:00:00.000Z');
    counter = 0;
    auditEntries = [];
    queueService = new QueueService({
      idGenerator: () => `job-${++counter}`,
      clock: () => now,
      auditService: {
        record(entry) {
          auditEntries.push(entry);
          return entry;
        }
      }
    });
  });

  it('enqueues, starts, and completes jobs', async () => {
    const job = await queueService.enqueueJob({
      organizationId: 'org-1',
      type: 'scheduling.generate',
      payload: { foo: 'bar' },
      priority: 1,
      maxAttempts: 2,
      createdBy: 'admin-1'
    });
    assert.equal(job.id, 'job-1');
    assert.equal(job.status, 'QUEUED');
    assert.equal(auditEntries.length, 1);

    const running = await queueService.startJob(job.id, { workerId: 'worker-1' });
    assert.equal(running.status, 'RUNNING');
    assert.equal(running.workerId, 'worker-1');
    assert.equal(running.attempts, 1);

    const completed = await queueService.completeJob(job.id, {
      workerId: 'worker-1',
      result: { ok: true }
    });
    assert.equal(completed.status, 'COMPLETED');
    assert.deepEqual(completed.result, { ok: true });
  });

  it('prevents duplicate queued jobs with the same dedupe key', async () => {
    const first = await queueService.enqueueJob({
      organizationId: 'org-1',
      type: 'parse',
      dedupeKey: 'job-key'
    });
    const second = await queueService.enqueueJob({
      organizationId: 'org-1',
      type: 'parse',
      dedupeKey: 'job-key'
    });
    assert.equal(second.id, first.id);
    const listed = await queueService.listJobs({ organizationId: 'org-1' });
    assert.equal(listed.length, 1);
    await queueService.startJob(first.id, { workerId: 'worker-1' });
    const third = await queueService.enqueueJob({
      organizationId: 'org-1',
      type: 'parse',
      dedupeKey: 'job-key'
    });
    assert.notEqual(third.id, first.id);
  });

  it('records failures and allows manual retry from dead letter', async () => {
    const job = await queueService.enqueueJob({
      organizationId: 'org-1',
      type: 'sync.external',
      maxAttempts: 1
    });
    await queueService.startJob(job.id, { workerId: 'worker-2' });
    const failed = await queueService.failJob(job.id, {
      workerId: 'worker-2',
      error: new Error('boom'),
      retryable: true
    });
    assert.equal(failed.status, 'DEAD_LETTER');
    assert.equal(failed.lastError, 'boom');
    const retried = await queueService.retryJob(job.id, { actorId: 'admin-1' });
    assert.equal(retried.status, 'QUEUED');
    assert.equal(auditEntries.length, 2);
  });

  it('cancels running jobs with reason metadata', async () => {
    const job = await queueService.enqueueJob({
      organizationId: 'org-1',
      type: 'sync.external'
    });
    await queueService.startJob(job.id, { workerId: 'worker-3' });
    const cancelled = await queueService.cancelJob(job.id, {
      actorId: 'admin-1',
      reason: 'maintenance'
    });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.lastError, 'maintenance');
    assert.equal(auditEntries.length, 2);
  });
});
