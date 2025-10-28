import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SchedulingService } from '../src/services/scheduling-service.js';
import { AvailabilityService } from '../src/services/availability-service.js';
import { EventService } from '../src/services/event-service.js';
import { QueueService } from '../src/services/queue-service.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('SchedulingService', () => {
  let eventService;
  let availabilityService;
  let schedulingService;
  let now;

  beforeEach(() => {
    let eventCounter = 0;
    eventService = new EventService({
      idGenerator: () => `event-${++eventCounter}`,
      clock: () => new Date('2024-04-01T00:00:00.000Z')
    });
    availabilityService = new AvailabilityService({
      eventService,
      clock: () => new Date(now || '2024-04-02T00:00:00.000Z')
    });
    schedulingService = new SchedulingService({
      eventService,
      availabilityService,
      clock: () => new Date(now || '2024-04-02T00:00:00.000Z'),
      idGenerator: () => 'suggestion-1'
    });
    now = '2024-04-02T00:00:00.000Z';
  });

  it('produces a ready suggestion and commits events', async () => {
    const suggestion = await schedulingService.runSchedulingJob({
      organizationId: 'org-1',
      userIds: ['user-1', 'user-2'],
      rangeStart: '2024-04-03T09:00:00Z',
      rangeEnd: '2024-04-03T12:00:00Z',
      durationMinutes: 60,
      title: 'Auto Shift'
    }, { createdBy: 'admin-1' });
    assert.equal(suggestion.status, 'PENDING');

    await wait(30);
    const ready = await schedulingService.getSuggestion(suggestion.id);
    assert.equal(ready.status, 'READY');
    assert.equal(ready.outputPlan.events.length, 1);

    const commitResult = await schedulingService.commitSuggestion(suggestion.id, { actorId: 'admin-1' });
    assert.equal(commitResult.events.length, 1);
    const storedEvents = await eventService.listEvents({ organizationId: 'org-1' });
    assert.equal(storedEvents.length, 1);
    assert.equal(storedEvents[0].title, 'Auto Shift');
    const committed = await schedulingService.getSuggestion(suggestion.id);
    assert.equal(committed.status, 'COMMITTED');
    assert.equal(committed.resultingEventIds.length, 1);
  });

  it('marks suggestions as failed when no window is available', async () => {
    await eventService.createEvent({
      organizationId: 'org-1',
      title: 'Existing',
      start: '2024-04-03T09:00:00Z',
      end: '2024-04-03T12:00:00Z',
      assigneeIds: ['user-1', 'user-2']
    });

    const suggestion = await schedulingService.runSchedulingJob({
      organizationId: 'org-1',
      userIds: ['user-1', 'user-2'],
      rangeStart: '2024-04-03T09:00:00Z',
      rangeEnd: '2024-04-03T12:00:00Z',
      durationMinutes: 60
    });

    await wait(30);
    const failed = await schedulingService.getSuggestion(suggestion.id);
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.errors[0], 'No feasible windows for requested duration');
    await assert.rejects(
      schedulingService.commitSuggestion(suggestion.id, { actorId: 'admin-1' }),
      (error) => error.code === 'SCHEDULING_NOT_READY'
    );
  });

  it('coordinates queue jobs alongside scheduling lifecycle', async () => {
    let jobCounter = 0;
    const queueService = new QueueService({
      idGenerator: () => `job-${++jobCounter}`,
      clock: () => new Date('2024-04-02T00:00:00.000Z')
    });
    schedulingService = new SchedulingService({
      eventService,
      availabilityService,
      clock: () => new Date('2024-04-02T00:00:00.000Z'),
      idGenerator: () => 'suggestion-queue',
      queueService
    });

    const suggestion = await schedulingService.runSchedulingJob({
      organizationId: 'org-1',
      userIds: ['user-1'],
      rangeStart: '2024-04-03T09:00:00Z',
      rangeEnd: '2024-04-03T11:00:00Z',
      durationMinutes: 60
    });
    assert.equal(suggestion.queueJobId, 'job-1');

    await wait(30);
    const resolved = await schedulingService.getSuggestion(suggestion.id);
    assert.equal(resolved.status, 'READY');
    const queueJob = await queueService.getJob('job-1');
    assert.equal(queueJob.status, 'COMPLETED');

    await eventService.createEvent({
      organizationId: 'org-1',
      title: 'Blocker',
      start: '2024-04-04T09:00:00Z',
      end: '2024-04-04T12:00:00Z',
      assigneeIds: ['user-2']
    });
    const failingSuggestion = await schedulingService.runSchedulingJob({
      organizationId: 'org-1',
      userIds: ['user-2'],
      rangeStart: '2024-04-04T09:00:00Z',
      rangeEnd: '2024-04-04T12:00:00Z',
      durationMinutes: 180
    });
    await wait(30);
    const failed = await schedulingService.getSuggestion(failingSuggestion.id);
    const failedJob = await queueService.getJob(failed.queueJobId);
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.queueJobId, 'job-2');
    assert.equal(failedJob.status, 'FAILED');
  });
});
