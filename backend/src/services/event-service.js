import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

function ensureDate(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    const err = new Error(`Invalid date for ${field}`);
    err.code = 'EVENT_INVALID_DATE';
    err.field = field;
    throw err;
  }
  return date;
}

function ensureTimeRange(start, end) {
  if (start >= end) {
    const err = new Error('Event end must be after start');
    err.code = 'EVENT_INVALID_RANGE';
    throw err;
  }
}

function dedupeAssignees(assigneeIds = []) {
  if (!Array.isArray(assigneeIds)) {
    const err = new Error('assigneeIds must be an array');
    err.code = 'EVENT_INVALID_PAYLOAD';
    throw err;
  }
  const unique = Array.from(new Set(assigneeIds.filter((id) => typeof id === 'string' && id.trim() !== '')));
  return unique;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function cloneEvent(event) {
  if (!event) {
    return null;
  }
  return {
    ...event,
    assigneeIds: Array.isArray(event.assigneeIds) ? [...event.assigneeIds] : []
  };
}

class InMemoryEventStore {
  constructor() {
    this.events = new Map();
    this.eventsByOrg = new Map();
  }

  #getOrgSet(orgId) {
    if (!this.eventsByOrg.has(orgId)) {
      this.eventsByOrg.set(orgId, new Set());
    }
    return this.eventsByOrg.get(orgId);
  }

  async getEvent(eventId) {
    const event = this.events.get(eventId);
    return event ? cloneEvent(event) : null;
  }

  async listEvents({ organizationId, start, end } = {}) {
    if (!organizationId) {
      return [];
    }
    const orgSet = this.eventsByOrg.get(organizationId);
    if (!orgSet) {
      return [];
    }
    const filterStart = start ? new Date(start) : null;
    const filterEnd = end ? new Date(end) : null;
    const events = [];
    for (const eventId of orgSet) {
      const event = this.events.get(eventId);
      if (!event) {
        continue;
      }
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);
      if (filterStart && eventEnd <= filterStart) {
        continue;
      }
      if (filterEnd && eventStart >= filterEnd) {
        continue;
      }
      events.push(cloneEvent(event));
    }
    events.sort((a, b) => new Date(a.start) - new Date(b.start));
    return events;
  }

  async findConflicts({ organizationId, assigneeIds, start, end, excludeEventId } = {}) {
    if (!organizationId || !Array.isArray(assigneeIds) || assigneeIds.length === 0) {
      return [];
    }
    const orgSet = this.eventsByOrg.get(organizationId);
    if (!orgSet) {
      return [];
    }
    const startDate = new Date(start);
    const endDate = new Date(end);
    const conflicts = [];
    for (const otherId of orgSet) {
      if (otherId === excludeEventId) {
        continue;
      }
      const other = this.events.get(otherId);
      if (!other || !other.assigneeIds.length) {
        continue;
      }
      const otherStart = new Date(other.start);
      const otherEnd = new Date(other.end);
      if (!overlaps(startDate, endDate, otherStart, otherEnd)) {
        continue;
      }
      const overlappingAssignees = other.assigneeIds.filter((id) => assigneeIds.includes(id));
      if (overlappingAssignees.length) {
        conflicts.push({
          eventId: other.id,
          assigneeIds: overlappingAssignees,
          start: other.start,
          end: other.end
        });
      }
    }
    return conflicts;
  }

  async createEvent(event) {
    const stored = cloneEvent(event);
    this.events.set(stored.id, stored);
    this.#getOrgSet(stored.organizationId).add(stored.id);
    return cloneEvent(stored);
  }

  async updateEvent(event) {
    const stored = cloneEvent(event);
    this.events.set(stored.id, stored);
    this.#getOrgSet(stored.organizationId).add(stored.id);
    return cloneEvent(stored);
  }

  async deleteEvent(eventId) {
    const existing = this.events.get(eventId);
    if (!existing) {
      return false;
    }
    this.events.delete(eventId);
    const orgSet = this.eventsByOrg.get(existing.organizationId);
    if (orgSet) {
      orgSet.delete(eventId);
      if (!orgSet.size) {
        this.eventsByOrg.delete(existing.organizationId);
      }
    }
    return true;
  }
}

class EventService {
  constructor({
    idGenerator = randomUUID,
    clock = () => new Date(),
    eventBus = null,
    metricsService = null,
    store
  } = {}) {
    this.idGenerator = idGenerator;
    this.clock = clock;
    this.eventBus = eventBus;
    this.metricsService = metricsService;
    this.store = store ?? new InMemoryEventStore();
  }

  #startDbTimer() {
    if (!this.metricsService) {
      return null;
    }
    return performance.now();
  }

  #finishDbTimer(start, operation, success = true) {
    if (!this.metricsService || start === null || start === undefined) {
      return;
    }
    const duration = Math.max(0, performance.now() - start);
    this.metricsService.recordDbQuery({
      model: 'Event',
      operation,
      durationMs: duration,
      success
    });
  }

  async getEvent(eventId) {
    const timer = this.#startDbTimer();
    let success = false;
    try {
      const event = await this.store.getEvent(eventId);
      success = true;
      return cloneEvent(event);
    } finally {
      this.#finishDbTimer(timer, 'get', success);
    }
  }

  async listEvents({ organizationId, start, end } = {}) {
    const timer = this.#startDbTimer();
    let success = false;
    try {
      if (!organizationId) {
        success = true;
        return [];
      }
      const filter = { organizationId };
      if (start) {
        filter.start = ensureDate(start, 'start').toISOString();
      }
      if (end) {
        filter.end = ensureDate(end, 'end').toISOString();
      }
      const events = await this.store.listEvents(filter);
      success = true;
      return events.map((event) => cloneEvent(event));
    } finally {
      this.#finishDbTimer(timer, 'list', success);
    }
  }

  async #findConflicts({ organizationId, assigneeIds, start, end, excludeEventId }) {
    return await this.store.findConflicts({
      organizationId,
      assigneeIds,
      start,
      end,
      excludeEventId
    });
  }

  async createEvent({
    organizationId,
    title,
    start,
    end,
    createdBy,
    allDay = false,
    color = null,
    description = null,
    assigneeIds = [],
    metadata = null
  }) {
    if (!organizationId || !title) {
      const err = new Error('organizationId and title are required');
      err.code = 'EVENT_INVALID_PAYLOAD';
      throw err;
    }
    if (!start || !end) {
      const err = new Error('start and end are required');
      err.code = 'EVENT_INVALID_PAYLOAD';
      throw err;
    }
    const startDate = ensureDate(start, 'start');
    const endDate = ensureDate(end, 'end');
    ensureTimeRange(startDate, endDate);
    const normalizedAssignees = dedupeAssignees(assigneeIds);
    const conflicts = await this.#findConflicts({
      organizationId,
      assigneeIds: normalizedAssignees,
      start: startDate.toISOString(),
      end: endDate.toISOString()
    });
    if (conflicts.length) {
      const err = new Error('Event conflicts with existing assignments');
      err.code = 'EVENT_CONFLICT';
      err.conflicts = conflicts;
      throw err;
    }
    const now = this.clock();
    const event = {
      id: this.idGenerator(),
      organizationId,
      title,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      allDay: Boolean(allDay),
      color,
      description,
      assigneeIds: normalizedAssignees,
      createdBy: createdBy || null,
      updatedBy: createdBy || null,
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      metadata
    };
    const timer = this.#startDbTimer();
    try {
      const stored = await this.store.createEvent(event);
      this.#publish(organizationId, 'event.created', { event: cloneEvent(stored) });
      this.#finishDbTimer(timer, 'create', true);
      return cloneEvent(stored);
    } catch (error) {
      this.#finishDbTimer(timer, 'create', false);
      throw error;
    }
  }

  async updateEvent(eventId, {
    title,
    start,
    end,
    allDay,
    color,
    description,
    assigneeIds,
    updatedBy,
    expectedVersion,
    metadata
  }) {
    const existing = await this.getEvent(eventId);
    if (!existing) {
      const err = new Error('Event not found');
      err.code = 'EVENT_NOT_FOUND';
      throw err;
    }
    if (typeof expectedVersion !== 'number' || expectedVersion !== existing.version) {
      const err = new Error('Event version mismatch');
      err.code = 'EVENT_VERSION_MISMATCH';
      throw err;
    }
    const nextStart = start ? ensureDate(start, 'start') : new Date(existing.start);
    const nextEnd = end ? ensureDate(end, 'end') : new Date(existing.end);
    ensureTimeRange(nextStart, nextEnd);
    const normalizedAssignees = assigneeIds ? dedupeAssignees(assigneeIds) : existing.assigneeIds;
    const conflicts = await this.#findConflicts({
      organizationId: existing.organizationId,
      assigneeIds: normalizedAssignees,
      start: nextStart.toISOString(),
      end: nextEnd.toISOString(),
      excludeEventId: eventId
    });
    if (conflicts.length) {
      const err = new Error('Event conflicts with existing assignments');
      err.code = 'EVENT_CONFLICT';
      err.conflicts = conflicts;
      throw err;
    }
    const now = this.clock();
    const updated = {
      ...existing,
      title: title ?? existing.title,
      start: nextStart.toISOString(),
      end: nextEnd.toISOString(),
      allDay: typeof allDay === 'boolean' ? allDay : existing.allDay,
      color: color === undefined ? existing.color : color,
      description: description === undefined ? existing.description : description,
      assigneeIds: normalizedAssignees,
      updatedBy: updatedBy || existing.updatedBy,
      version: existing.version + 1,
      updatedAt: now.toISOString(),
      metadata: metadata === undefined ? existing.metadata ?? null : metadata
    };
    const timer = this.#startDbTimer();
    try {
      const stored = await this.store.updateEvent(updated);
      this.#publish(existing.organizationId, 'event.updated', {
        event: cloneEvent(stored),
        previous: cloneEvent(existing)
      });
      this.#finishDbTimer(timer, 'update', true);
      return cloneEvent(stored);
    } catch (error) {
      this.#finishDbTimer(timer, 'update', false);
      throw error;
    }
  }

  async deleteEvent(eventId, { expectedVersion } = {}) {
    const existing = await this.getEvent(eventId);
    if (!existing) {
      const err = new Error('Event not found');
      err.code = 'EVENT_NOT_FOUND';
      throw err;
    }
    if (typeof expectedVersion === 'number' && expectedVersion !== existing.version) {
      const err = new Error('Event version mismatch');
      err.code = 'EVENT_VERSION_MISMATCH';
      throw err;
    }
    const timer = this.#startDbTimer();
    try {
      await this.store.deleteEvent(eventId);
      this.#publish(existing.organizationId, 'event.deleted', { event: cloneEvent(existing) });
      this.#finishDbTimer(timer, 'delete', true);
      return cloneEvent(existing);
    } catch (error) {
      this.#finishDbTimer(timer, 'delete', false);
      throw error;
    }
  }

  #publish(organizationId, type, payload) {
    if (!this.eventBus) {
      return;
    }
    const channel = `org:${organizationId}`;
    this.eventBus.publish(channel, {
      type,
      payload,
      metadata: { organizationId }
    });
  }
}

export { EventService, InMemoryEventStore };
