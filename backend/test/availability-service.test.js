import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AvailabilityService } from '../src/services/availability-service.js';
import { EventService } from '../src/services/event-service.js';

describe('AvailabilityService', () => {
  let availabilityService;
  let eventService;

  beforeEach(() => {
    let eventCounter = 0;
    eventService = new EventService({
      idGenerator: () => `event-${++eventCounter}`,
      clock: () => new Date('2024-02-01T00:00:00.000Z')
    });
    availabilityService = new AvailabilityService({
      eventService,
      clock: () => new Date('2024-02-02T00:00:00.000Z'),
      idGenerator: () => `cache-${eventCounter}`
    });
  });

  it('computes shared free windows and conflict summaries', async () => {
    await eventService.createEvent({
      organizationId: 'org-1',
      title: 'Team Sync',
      start: '2024-03-01T09:30:00Z',
      end: '2024-03-01T10:30:00Z',
      assigneeIds: ['user-1']
    });
    await availabilityService.updateCache({
      organizationId: 'org-1',
      userId: 'user-2',
      rangeStart: '2024-03-01T09:00:00Z',
      rangeEnd: '2024-03-01T12:00:00Z',
      busy: [
        {
          start: '2024-03-01T11:00:00Z',
          end: '2024-03-01T11:30:00Z',
          source: 'external',
          referenceId: 'busy-1',
          label: 'Doctor visit'
        }
      ]
    });

    const result = await availabilityService.getAvailabilityWindows({
      organizationId: 'org-1',
      userIds: ['user-1', 'user-2'],
      rangeStart: '2024-03-01T09:00:00Z',
      rangeEnd: '2024-03-01T12:00:00Z',
      slotMinutes: 30
    });

    assert.equal(result.windows.length, 3);
    assert.deepEqual(
      result.windows.map((window) => [window.start, window.end]),
      [
        ['2024-03-01T09:00:00.000Z', '2024-03-01T09:30:00.000Z'],
        ['2024-03-01T10:30:00.000Z', '2024-03-01T11:00:00.000Z'],
        ['2024-03-01T11:30:00.000Z', '2024-03-01T12:00:00.000Z']
      ]
    );
    const conflictsByUser = new Map(result.conflicts.map((item) => [item.userId, item.intervals]));
    assert.ok(conflictsByUser.has('user-1'));
    assert.ok(conflictsByUser.has('user-2'));
    const user1Conflicts = conflictsByUser.get('user-1');
    assert.equal(user1Conflicts.length, 1);
    assert.equal(user1Conflicts[0].referenceId, 'event-1');
    const user2Conflicts = conflictsByUser.get('user-2');
    assert.equal(user2Conflicts.length, 1);
    assert.equal(user2Conflicts[0].referenceId, 'busy-1');
    assert.equal(result.generatedAt, '2024-02-02T00:00:00.000Z');
  });

  it('throws for invalid arguments', async () => {
    await assert.rejects(
      availabilityService.getAvailabilityWindows({
        organizationId: 'org-1',
        userIds: [],
        rangeStart: '2024-03-01T09:00:00Z',
        rangeEnd: '2024-03-01T10:00:00Z'
      }),
      (error) => error.code === 'AVAILABILITY_INVALID_ARGUMENT'
    );

    await assert.rejects(
      availabilityService.getCacheRecord({ organizationId: 'org-1' }),
      (error) => error.code === 'AVAILABILITY_INVALID_ARGUMENT'
    );

    await assert.rejects(
      availabilityService.listCacheRecords({}),
      (error) => error.code === 'AVAILABILITY_INVALID_ARGUMENT'
    );

    await assert.rejects(
      availabilityService.clearCache({ organizationId: 'org-1' }),
      (error) => error.code === 'AVAILABILITY_INVALID_ARGUMENT'
    );
  });

  it('manages cached busy records per organization and user', async () => {
    await availabilityService.updateCache({
      organizationId: 'org-1',
      userId: 'user-1',
      rangeStart: '2024-03-01T09:00:00Z',
      rangeEnd: '2024-03-01T11:00:00Z',
      busy: [{ start: '2024-03-01T10:00:00Z', end: '2024-03-01T10:30:00Z', referenceId: 'ext-1' }]
    });
    await availabilityService.updateCache({
      organizationId: 'org-1',
      userId: 'user-2',
      rangeStart: '2024-03-01T09:00:00Z',
      rangeEnd: '2024-03-01T12:00:00Z',
      busy: []
    });

    const record = await availabilityService.getCacheRecord({ organizationId: 'org-1', userId: 'user-1' });
    assert.ok(record);
    assert.equal(record.userId, 'user-1');
    assert.equal(record.busy.length, 1);

    const all = await availabilityService.listCacheRecords({ organizationId: 'org-1' });
    assert.equal(all.length, 2);

    const filtered = await availabilityService.listCacheRecords({ organizationId: 'org-1', userIds: ['user-2'] });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].userId, 'user-2');

    const removed = await availabilityService.clearCache({ organizationId: 'org-1', userId: 'user-1' });
    assert.equal(removed, true);
    assert.equal(await availabilityService.getCacheRecord({ organizationId: 'org-1', userId: 'user-1' }), null);
  });
});
