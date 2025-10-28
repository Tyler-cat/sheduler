import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/services/event-bus.js';

const fixedClock = () => new Date('2024-04-01T00:00:00Z');

describe('EventBus', () => {
  it('allows subscriptions and publishes messages with sequencing', () => {
    const bus = new EventBus({ clock: fixedClock });
    const received = [];
    const unsubscribe = bus.subscribe('org:org-1', (message) => {
      received.push(message);
    });

    const first = bus.publish('org:org-1', { type: 'event.created', payload: { id: '1' } });
    const second = bus.publish('org:org-1', { type: 'event.updated', payload: { id: '1' } });

    assert.equal(received.length, 2);
    assert.deepEqual(received.map((msg) => msg.sequence), [1, 2]);
    assert.equal(first.timestamp, '2024-04-01T00:00:00.000Z');
    assert.equal(second.type, 'event.updated');

    unsubscribe();
    bus.publish('org:org-1', { type: 'event.deleted', payload: { id: '1' } });
    assert.equal(received.length, 2);
  });

  it('returns channel history since a sequence', () => {
    const bus = new EventBus({ clock: fixedClock });
    bus.publish('org:org-1', { type: 'event.created', payload: { id: '1' } });
    bus.publish('org:org-2', { type: 'event.created', payload: { id: '2' } });
    bus.publish('org:org-1', { type: 'event.updated', payload: { id: '1' } });

    const history = bus.historySince('org:org-1', 1);
    assert.equal(history.length, 1);
    assert.equal(history[0].type, 'event.updated');
    assert.equal(history[0].sequence, 3);
  });
});
