import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaQueueStore } from '../src/stores/prisma-queue-store.js';
import { createMockPrisma } from './helpers/mock-prisma.js';

function baseJob(overrides = {}) {
  return {
    id: 'job-1',
    organizationId: 'org-1',
    type: 'parse',
    status: 'QUEUED',
    priority: 0,
    payload: {},
    attempts: 0,
    maxAttempts: 3,
    dedupeKey: null,
    createdBy: 'user-1',
    queuedAt: '2024-01-01T00:00:00Z',
    startedAt: null,
    completedAt: null,
    workerId: null,
    result: null,
    lastError: null,
    errorHistory: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides
  };
}

describe('PrismaQueueStore', () => {
  let prisma;
  let store;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaQueueStore({ prisma });
  });

  it('creates and retrieves queue jobs', async () => {
    const created = await store.create(baseJob({ id: 'job-a' }));
    assert.equal(created.id, 'job-a');
    assert.equal(created.status, 'QUEUED');
    const fetched = await store.get('job-a');
    assert.equal(fetched.id, 'job-a');
    const counts = await store.getQueuedCounts();
    assert.equal(counts.get('parse'), 1);
  });

  it('updates jobs and respects dedupe lookups', async () => {
    await store.create(baseJob({ id: 'job-dedupe', dedupeKey: 'dedupe-key' }));
    const active = await store.findActiveByDedupe('dedupe-key');
    assert.equal(active?.id, 'job-dedupe');
    const running = await store.update({
      ...active,
      status: 'RUNNING',
      attempts: 1,
      startedAt: '2024-01-01T00:05:00Z',
      updatedAt: '2024-01-01T00:05:00Z'
    });
    assert.equal(running.status, 'RUNNING');
    const stillActive = await store.findActiveByDedupe('dedupe-key');
    assert.equal(stillActive, null);
    await store.update({
      ...running,
      status: 'COMPLETED',
      completedAt: '2024-01-01T00:10:00Z',
      updatedAt: '2024-01-01T00:10:00Z'
    });
    const none = await store.findActiveByDedupe('dedupe-key');
    assert.equal(none, null);
  });

  it('lists scoped jobs with ordering and limits', async () => {
    await store.create(baseJob({ id: 'job-older', createdAt: '2024-01-01T00:00:00Z' }));
    await store.create(
      baseJob({
        id: 'job-failed',
        status: 'FAILED',
        createdAt: '2024-01-01T01:00:00Z',
        updatedAt: '2024-01-01T01:00:00Z',
        lastError: 'boom'
      })
    );
    await store.create(
      baseJob({
        id: 'job-completed',
        status: 'COMPLETED',
        createdAt: '2024-01-01T02:00:00Z',
        updatedAt: '2024-01-01T02:00:00Z'
      })
    );
    const failedJobs = await store.list({ organizationId: 'org-1', status: 'FAILED', limit: 5 });
    assert.equal(failedJobs.length, 1);
    assert.equal(failedJobs[0].id, 'job-failed');
    const latestQueued = await store.list({ organizationId: 'org-1', status: 'QUEUED', limit: 1 });
    assert.equal(latestQueued.length, 1);
    assert.equal(latestQueued[0].id, 'job-older');
  });
});
