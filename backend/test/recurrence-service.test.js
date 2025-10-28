import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventService } from '../src/services/event-service.js';
import { RecurrenceService } from '../src/services/recurrence-service.js';

describe('RecurrenceService', () => {
  let eventService;
  let recurrenceService;
  let event;

  beforeEach(async () => {
    let eventCounter = 0;
    eventService = new EventService({
      idGenerator: () => `event-${++eventCounter}`,
      clock: () => new Date('2024-02-01T00:00:00.000Z')
    });
    event = await eventService.createEvent({
      organizationId: 'org-1',
      title: 'Morning shift',
      start: '2024-02-05T09:00:00Z',
      end: '2024-02-05T10:30:00Z',
      assigneeIds: ['user-1']
    });
    recurrenceService = new RecurrenceService({
      eventService,
      idGenerator: () => 'recurrence-1',
      clock: () => new Date('2024-02-01T00:00:00.000Z')
    });
  });

  it('stores and returns recurrence metadata', async () => {
    const record = await recurrenceService.setRecurrence(
      event.id,
      {
        rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
        exdates: ['2024-02-12T09:00:00Z']
      },
      { actorId: 'admin-1' }
    );

    assert.equal(record.id, 'recurrence-1');
    assert.equal(record.eventId, event.id);
    assert.equal(record.organizationId, event.organizationId);
    assert.equal(record.rrule, 'FREQ=WEEKLY;BYDAY=MO,WE');
    assert.equal(record.interval, 1);
    assert.deepEqual(record.exdates, ['2024-02-12T09:00:00.000Z']);

    const loaded = recurrenceService.getRecurrence(event.id);
    assert.deepEqual(loaded, record);
  });

  it('expands weekly recurrences with exclusions', async () => {
    await recurrenceService.setRecurrence(event.id, {
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
      exdates: ['2024-02-07T09:00:00Z']
    });

    const { occurrences, truncated } = await recurrenceService.expandOccurrences(event.id, {
      rangeStart: '2024-02-05T00:00:00Z',
      rangeEnd: '2024-02-20T00:00:00Z'
    });

    assert.equal(truncated, false);
    const starts = occurrences.map((occ) => occ.start);
    assert.deepEqual(starts, [
      '2024-02-05T09:00:00.000Z',
      '2024-02-12T09:00:00.000Z',
      '2024-02-14T09:00:00.000Z',
      '2024-02-19T09:00:00.000Z'
    ]);
    for (const occ of occurrences) {
      assert.equal(occ.end, new Date(new Date(occ.start).getTime() + 90 * 60 * 1000).toISOString());
    }
  });

  it('supports daily recurrences with interval and count', async () => {
    await recurrenceService.setRecurrence(event.id, {
      rrule: 'FREQ=DAILY;INTERVAL=2;COUNT=3'
    });

    const { occurrences } = await recurrenceService.expandOccurrences(event.id, {
      rangeStart: '2024-02-05T00:00:00Z',
      rangeEnd: '2024-02-20T00:00:00Z'
    });

    assert.deepEqual(
      occurrences.map((occ) => occ.start),
      ['2024-02-05T09:00:00.000Z', '2024-02-07T09:00:00.000Z', '2024-02-09T09:00:00.000Z']
    );
  });

  it('removes recurrence state when requested', async () => {
    await recurrenceService.setRecurrence(event.id, {
      rrule: 'FREQ=DAILY'
    });

    const removed = recurrenceService.removeRecurrence(event.id);
    assert.ok(removed);
    assert.equal(recurrenceService.getRecurrence(event.id), null);
  });
});
