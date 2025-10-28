import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../src/app.js';
import { OrganizationService } from '../src/services/organization-service.js';
import { EventService } from '../src/services/event-service.js';
import { EventBus } from '../src/services/event-bus.js';
import { MetricsService } from '../src/services/metrics-service.js';

function encodeSession(session) {
  return Buffer.from(JSON.stringify(session)).toString('base64url');
}

function createSessionParser() {
  return async (req) => {
    const raw = req.headers['x-test-session'];
    if (!raw) {
      return {};
    }
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  };
}

async function startApp(app) {
  return new Promise((resolve) => {
    const server = app.listen(() => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function stopApp(app) {
  return new Promise((resolve) => {
    app.close(() => resolve());
  });
}

async function readWithTimeout(reader, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out reading SSE stream')), timeoutMs);
    reader.read().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function readUntil(state, predicate, timeoutMs = 2000) {
  while (true) {
    const match = predicate(state.buffer);
    if (match) {
      return typeof match === 'string' ? match : state.buffer;
    }
    const { value, done } = await readWithTimeout(state.reader, timeoutMs);
    if (done) {
      throw new Error('Stream closed before condition was met');
    }
    state.buffer += state.decoder.decode(value, { stream: true });
  }
}

describe('realtime event stream', () => {
  let organizationService;
  let eventService;
  let eventBus;
  let metricsService;
  let app;

  beforeEach(() => {
    let orgCounter = 0;
    let eventCounter = 0;
    const orgIds = ['org-1'];
    const eventIds = ['event-1'];
    organizationService = new OrganizationService({
      idGenerator: () => orgIds[orgCounter++] || `org-${orgCounter}`
    });
    eventBus = new EventBus({ clock: () => new Date('2024-02-01T00:00:00.000Z') });
    eventService = new EventService({
      idGenerator: () => eventIds[eventCounter++] || `event-${eventCounter}`,
      clock: () => new Date('2024-02-01T00:00:00.000Z'),
      eventBus
    });
    metricsService = new MetricsService();
    app = createApp({
      port: 0,
      services: { organizationService, eventService, eventBus, metricsService },
      sessionParser: createSessionParser()
    });
  });

  it('requires authentication for SSE connections', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    const { port } = await startApp(app);
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/events/stream?organizationId=${org.id}`
      );
      assert.equal(response.status, 401);
    } finally {
      await stopApp(app);
    }
  });

  it('rejects users without organization scope', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    const { port } = await startApp(app);
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/events/stream?organizationId=${org.id}`,
        {
          headers: {
            'x-test-session': encodeSession({
              user: { id: 'staff-1', globalRole: 'STAFF', orgIds: [] }
            })
          }
        }
      );
      assert.equal(response.status, 403);
    } finally {
      await stopApp(app);
    }
  });

  it('streams live events to scoped users', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');
    const { port } = await startApp(app);
    const sessionHeader = encodeSession({
      user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] }
    });

    const streamResponse = await fetch(
      `http://127.0.0.1:${port}/api/events/stream?organizationId=${org.id}`,
      {
        headers: {
          Accept: 'text/event-stream',
          'x-test-session': sessionHeader
        }
      }
    );
    assert.equal(streamResponse.status, 200);
    const state = {
      reader: streamResponse.body.getReader(),
      decoder: new TextDecoder(),
      buffer: ''
    };

    await readUntil(state, (buffer) => buffer.includes(':connected'));

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-session': sessionHeader
      },
      body: JSON.stringify({
        organizationId: org.id,
        title: 'Shift',
        start: '2024-02-01T09:00:00Z',
        end: '2024-02-01T10:00:00Z'
      })
    });
    assert.equal(createResponse.status, 201);

    const eventBuffer = await readUntil(state, (buffer) =>
      buffer.includes('event: event.created')
    );
    assert.match(eventBuffer, /event: event.created/);
    assert.match(eventBuffer, /"title":"Shift"/);

    await state.reader.cancel();
    await delay(10);

    const snapshot = metricsService.getSnapshot();
    const open = snapshot.counters.find(
      (entry) =>
        entry.name === 'realtime_connections_total' &&
        entry.labels.channel === 'org' &&
        entry.labels.status === 'open'
    );
    const closed = snapshot.counters.find(
      (entry) =>
        entry.name === 'realtime_connections_total' &&
        entry.labels.channel === 'org' &&
        entry.labels.status === 'closed'
    );
    const delivered = snapshot.counters.find(
      (entry) =>
        entry.name === 'realtime_messages_total' &&
        entry.labels.channel === 'org' &&
        entry.labels.event === 'event.created'
    );
    const gauge = snapshot.gauges.find(
      (entry) => entry.name === 'session_concurrency_gauge' && entry.labels.channel === 'sse'
    );
    const latency = snapshot.summaries.find((entry) => entry.name === 'socket_broadcast_latency_ms');
    assert.equal(open?.value, 1);
    assert.equal(closed?.value, 1);
    assert.equal(delivered?.value, 1);
    assert.equal(gauge?.value, 0);
    assert.ok(latency, 'socket_broadcast_latency_ms metric should be recorded');
    assert.equal(latency.count, 1);
    assert(latency.max >= 0);

    await stopApp(app);
  });

  it('replays history when Last-Event-ID is provided', async () => {
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');
    await eventService.createEvent({
      organizationId: org.id,
      title: 'Existing shift',
      start: '2024-02-01T09:00:00Z',
      end: '2024-02-01T10:00:00Z',
      createdBy: 'admin-1'
    });

    const { port } = await startApp(app);
    const sessionHeader = encodeSession({
      user: { id: 'admin-1', globalRole: 'ADMIN', orgIds: [org.id] }
    });

    const streamResponse = await fetch(
      `http://127.0.0.1:${port}/api/events/stream?organizationId=${org.id}`,
      {
        headers: {
          Accept: 'text/event-stream',
          'x-test-session': sessionHeader,
          'Last-Event-ID': '0'
        }
      }
    );
    assert.equal(streamResponse.status, 200);
    const state = {
      reader: streamResponse.body.getReader(),
      decoder: new TextDecoder(),
      buffer: ''
    };

    const replayBuffer = await readUntil(state, (buffer) =>
      buffer.includes('event: event.created')
    );
    assert.match(replayBuffer, /Existing shift/);

    await state.reader.cancel();
    await stopApp(app);
  });
});
