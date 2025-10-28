import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventService } from '../src/services/event-service.js';
import { EventBus } from '../src/services/event-bus.js';

describe('EventService', () => {
  let service;
  let now;
  beforeEach(() => {
    let counter = 0;
    const ids = ['event-1', 'event-2', 'event-3'];
    service = new EventService({
      idGenerator: () => ids[counter++] || `event-${counter}`,
      clock: () => {
        now = new Date('2024-01-01T00:00:00.000Z');
        return now;
      }
    });
  });

  it('creates and lists events with filtering', async () => {
    const created = await service.createEvent({
      organizationId: 'org-1',
      title: 'Kickoff',
      start: '2024-02-01T09:00:00Z',
      end: '2024-02-01T10:00:00Z',
      assigneeIds: ['user-1', 'user-2'],
      createdBy: 'admin-1'
    });
    assert.equal(created.id, 'event-1');
    assert.equal(created.version, 1);
    assert.equal(created.createdBy, 'admin-1');

    const list = await service.listEvents({ organizationId: 'org-1' });
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);

    const empty = await service.listEvents({ organizationId: 'org-1', start: '2024-02-02T00:00:00Z' });
    assert.equal(empty.length, 0);
  });

  it('prevents overlapping assignments for the same user', async () => {
    await service.createEvent({
      organizationId: 'org-1',
      title: 'Event A',
      start: '2024-02-01T09:00:00Z',
      end: '2024-02-01T10:00:00Z',
      assigneeIds: ['user-1']
    });

    await assert.rejects(
      service.createEvent({
        organizationId: 'org-1',
        title: 'Event B',
        start: '2024-02-01T09:30:00Z',
        end: '2024-02-01T11:00:00Z',
        assigneeIds: ['user-1', 'user-2']
      }),
      (error) => error.code === 'EVENT_CONFLICT'
    );
  });

  it('updates events with optimistic concurrency', async () => {
    const event = await service.createEvent({
      organizationId: 'org-1',
      title: 'Shift',
      start: '2024-02-01T09:00:00Z',
      end: '2024-02-01T10:00:00Z',
      assigneeIds: ['user-1']
    });
    assert.equal(event.version, 1);

    const updated = await service.updateEvent(event.id, {
      title: 'Updated Shift',
      start: '2024-02-01T09:30:00Z',
      end: '2024-02-01T10:30:00Z',
      expectedVersion: 1,
      assigneeIds: ['user-1']
    });
    assert.equal(updated.version, 2);
    assert.equal(updated.title, 'Updated Shift');

    await assert.rejects(
      service.updateEvent(event.id, {
        title: 'Mismatch',
        expectedVersion: 1
      }),
      (error) => error.code === 'EVENT_VERSION_MISMATCH'
    );
  });

  it('deletes events with optional version guard', async () => {
    const event = await service.createEvent({
      organizationId: 'org-1',
      title: 'Shift',
      start: '2024-02-01T09:00:00Z',
      end: '2024-02-01T10:00:00Z',
      assigneeIds: ['user-1']
    });
    await service.deleteEvent(event.id, { expectedVersion: 1 });
    const remaining = await service.listEvents({ organizationId: 'org-1' });
    assert.equal(remaining.length, 0);

    await assert.rejects(service.deleteEvent(event.id), (error) => error.code === 'EVENT_NOT_FOUND');
  });

  it('publishes lifecycle events to the event bus', async () => {
    const messages = [];
    const clock = () => new Date('2024-03-01T00:00:00Z');
    const bus = new EventBus({ clock });
    const unsubscribe = bus.subscribe('org:org-1', (message) => {
      messages.push(message);
    });
    const busAwareService = new EventService({
      idGenerator: () => `event-${messages.length + 1}`,
      clock,
      eventBus: bus
    });

    const created = await busAwareService.createEvent({
      organizationId: 'org-1',
      title: 'Planning',
      start: '2024-03-05T09:00:00Z',
      end: '2024-03-05T10:00:00Z',
      assigneeIds: ['user-1']
    });
    const updated = await busAwareService.updateEvent(created.id, {
      title: 'Updated Planning',
      start: '2024-03-05T09:30:00Z',
      end: '2024-03-05T10:30:00Z',
      expectedVersion: 1
    });
    await busAwareService.deleteEvent(updated.id, { expectedVersion: 2 });

    unsubscribe();

    assert.equal(messages.length, 3);
    assert.deepEqual(
      messages.map((msg) => msg.type),
      ['event.created', 'event.updated', 'event.deleted']
    );
    assert.ok(messages.every((msg) => msg.channel === 'org:org-1'));
    assert.ok(messages.every((msg) => msg.sequence > 0));
    assert.deepEqual(messages[0].payload.event.id, created.id);
    assert.equal(messages[1].payload.event.version, 2);
    assert.equal(messages[2].payload.event.id, created.id);
  });
});
