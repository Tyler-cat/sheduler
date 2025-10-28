import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaAvailabilityStore } from '../src/stores/prisma-availability-store.js';
import { createMockPrisma } from './helpers/mock-prisma.js';

describe('PrismaAvailabilityStore', () => {
  let prisma;
  let store;
  let now;

  beforeEach(() => {
    prisma = createMockPrisma();
    now = new Date('2024-07-01T00:00:00.000Z');
    let counter = 0;
    store = new PrismaAvailabilityStore({
      prisma,
      clock: () => now,
      idGenerator: () => `cache-${++counter}`
    });
  });

  it('creates and reads availability cache records', async () => {
    const created = await store.upsertCacheRecord({
      organizationId: 'org-1',
      userId: 'user-1',
      source: 'external',
      rangeStart: '2024-07-01T08:00:00Z',
      rangeEnd: '2024-07-01T10:00:00Z',
      busy: [
        {
          start: '2024-07-01T09:00:00Z',
          end: '2024-07-01T09:30:00Z',
          referenceId: 'busy-1',
          label: 'Conflict'
        }
      ],
      updatedAt: '2024-07-01T00:00:00Z'
    });

    assert.equal(created.id, 'cache-1');
    assert.equal(created.organizationId, 'org-1');
    assert.equal(created.userId, 'user-1');
    assert.equal(created.busy.length, 1);
    assert.equal(created.busy[0].start, '2024-07-01T09:00:00.000Z');
    assert.equal(created.busy[0].end, '2024-07-01T09:30:00.000Z');
    assert.equal(created.updatedAt, '2024-07-01T00:00:00.000Z');

    const fetched = await store.getCacheRecord({ organizationId: 'org-1', userId: 'user-1' });
    assert.deepEqual(fetched, created);
  });

  it('updates existing cache entries and preserves ordering', async () => {
    await store.upsertCacheRecord({
      organizationId: 'org-1',
      userId: 'user-1',
      source: 'external',
      rangeStart: '2024-07-01T08:00:00Z',
      rangeEnd: '2024-07-01T10:00:00Z',
      busy: [],
      updatedAt: '2024-07-01T00:00:00Z'
    });
    now = new Date('2024-07-01T02:00:00.000Z');
    const updated = await store.upsertCacheRecord({
      organizationId: 'org-1',
      userId: 'user-1',
      source: 'manual',
      rangeStart: '2024-07-01T08:30:00Z',
      rangeEnd: '2024-07-01T10:30:00Z',
      busy: [
        { start: '2024-07-01T08:30:00Z', end: '2024-07-01T09:00:00Z', referenceId: 'busy-2' }
      ],
      updatedAt: '2024-07-01T02:00:00Z'
    });
    assert.equal(updated.source, 'manual');
    assert.equal(updated.busy.length, 1);
    await store.upsertCacheRecord({
      organizationId: 'org-1',
      userId: 'user-2',
      rangeStart: '2024-07-01T09:00:00Z',
      rangeEnd: '2024-07-01T11:00:00Z',
      busy: [],
      updatedAt: '2024-07-01T01:00:00Z'
    });

    const records = await store.listCacheRecords({ organizationId: 'org-1' });
    assert.equal(records.length, 2);
    assert.equal(records[0].userId, 'user-1');
    assert.equal(records[0].source, 'manual');
    assert.equal(records[0].busy.length, 1);
    assert.equal(records[1].userId, 'user-2');

    const filtered = await store.listCacheRecords({ organizationId: 'org-1', userIds: ['user-2'] });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].userId, 'user-2');
  });

  it('deletes cache entries by organization scope', async () => {
    await store.upsertCacheRecord({
      organizationId: 'org-1',
      userId: 'user-1',
      rangeStart: '2024-07-01T08:00:00Z',
      rangeEnd: '2024-07-01T09:00:00Z',
      busy: [],
      updatedAt: '2024-07-01T00:00:00Z'
    });

    const removed = await store.deleteCacheRecord({ organizationId: 'org-1', userId: 'user-1' });
    assert.equal(removed, true);
    const remaining = await store.getCacheRecord({ organizationId: 'org-1', userId: 'user-1' });
    assert.equal(remaining, null);
    const missing = await store.deleteCacheRecord({ organizationId: 'org-1', userId: 'user-2' });
    assert.equal(missing, false);
  });
});
