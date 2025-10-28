import { randomUUID } from 'node:crypto';

function toDate(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    const error = new Error(`Invalid date for ${field}`);
    error.code = 'AVAILABILITY_INVALID_DATE';
    error.field = field;
    throw error;
  }
  return date;
}

function normalizeBusyEntry(entry) {
  if (!entry || !entry.start || !entry.end) {
    const error = new Error('Busy entry requires start and end');
    error.code = 'AVAILABILITY_INVALID_BUSY_ENTRY';
    throw error;
  }
  const start = toDate(entry.start, 'busy.start');
  const end = toDate(entry.end, 'busy.end');
  if (start >= end) {
    const error = new Error('Busy entry end must be after start');
    error.code = 'AVAILABILITY_INVALID_BUSY_ENTRY';
    throw error;
  }
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    source: entry.source || 'cache',
    referenceId: entry.referenceId || null,
    label: entry.label || null
  };
}

function minutesBetween(start, end) {
  return Math.max(0, Math.ceil((end - start) / (60 * 1000)));
}

function addMinutes(base, minutes) {
  return new Date(base.getTime() + minutes * 60 * 1000);
}

class AvailabilityService {
  constructor({
    idGenerator = randomUUID,
    clock = () => new Date(),
    eventService = null,
    store = null
  } = {}) {
    this.idGenerator = idGenerator;
    this.clock = clock;
    this.eventService = eventService;
    this.store = store;
    this.cache = store ? null : new Map();
  }

  #cacheKey(orgId, userId) {
    return `${orgId}:${userId}`;
  }

  #cloneBusy(busy) {
    return Array.isArray(busy) ? busy.map((item) => ({ ...item })) : [];
  }

  async updateCache({ organizationId, userId, rangeStart, rangeEnd, busy = [], source = 'external' }) {
    if (!organizationId || !userId) {
      const error = new Error('organizationId and userId are required');
      error.code = 'AVAILABILITY_INVALID_ARGUMENT';
      throw error;
    }
    const rangeStartDate = toDate(rangeStart, 'rangeStart');
    const rangeEndDate = toDate(rangeEnd, 'rangeEnd');
    if (rangeStartDate >= rangeEndDate) {
      const error = new Error('rangeEnd must be after rangeStart');
      error.code = 'AVAILABILITY_INVALID_RANGE';
      throw error;
    }
    const normalizedBusy = (Array.isArray(busy) ? busy : []).map((entry) => normalizeBusyEntry(entry));
    const baseRecord = {
      organizationId,
      userId,
      source,
      rangeStart: rangeStartDate.toISOString(),
      rangeEnd: rangeEndDate.toISOString(),
      busy: normalizedBusy,
      updatedAt: this.clock().toISOString()
    };
    if (this.store) {
      const stored = await this.store.upsertCacheRecord(baseRecord);
      return { ...stored, busy: this.#cloneBusy(stored.busy) };
    }
    const cacheKey = this.#cacheKey(organizationId, userId);
    const record = {
      id: this.idGenerator(),
      ...baseRecord
    };
    this.cache.set(cacheKey, record);
    return { ...record, busy: this.#cloneBusy(record.busy) };
  }

  async getCacheRecord({ organizationId, userId }) {
    if (!organizationId || !userId) {
      const error = new Error('organizationId and userId are required');
      error.code = 'AVAILABILITY_INVALID_ARGUMENT';
      throw error;
    }
    if (this.store) {
      const record = await this.store.getCacheRecord({ organizationId, userId });
      if (!record) {
        return null;
      }
      return { ...record, busy: this.#cloneBusy(record.busy) };
    }
    const entry = this.cache.get(this.#cacheKey(organizationId, userId));
    if (!entry) {
      return null;
    }
    return {
      ...entry,
      busy: this.#cloneBusy(entry.busy)
    };
  }

  async listCacheRecords({ organizationId, userIds = [] } = {}) {
    if (!organizationId) {
      const error = new Error('organizationId is required');
      error.code = 'AVAILABILITY_INVALID_ARGUMENT';
      throw error;
    }
    const filterIds = Array.isArray(userIds) ? userIds.filter((id) => typeof id === 'string' && id) : [];
    const shouldFilter = filterIds.length > 0;
    if (this.store) {
      const records = await this.store.listCacheRecords({ organizationId, userIds: filterIds });
      return records.map((record) => ({ ...record, busy: this.#cloneBusy(record.busy) }));
    }
    const records = [];
    for (const entry of this.cache.values()) {
      if (entry.organizationId !== organizationId) {
        continue;
      }
      if (shouldFilter && !filterIds.includes(entry.userId)) {
        continue;
      }
      records.push({
        ...entry,
        busy: this.#cloneBusy(entry.busy)
      });
    }
    records.sort((a, b) => {
      if (a.userId === b.userId) {
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      }
      return a.userId.localeCompare(b.userId);
    });
    return records;
  }

  async clearCache({ organizationId, userId }) {
    if (!organizationId || !userId) {
      const error = new Error('organizationId and userId are required');
      error.code = 'AVAILABILITY_INVALID_ARGUMENT';
      throw error;
    }
    if (this.store) {
      return this.store.deleteCacheRecord({ organizationId, userId });
    }
    return this.cache.delete(this.#cacheKey(organizationId, userId));
  }

  async #collectBusyFromCache(organizationId, userId, rangeStart, rangeEnd) {
    const entry = await (this.store
      ? this.store.getCacheRecord({ organizationId, userId })
      : Promise.resolve(this.cache.get(this.#cacheKey(organizationId, userId))));
    if (!entry) {
      return [];
    }
    const busy = [];
    for (const item of entry.busy || []) {
      const itemStart = new Date(item.start);
      const itemEnd = new Date(item.end);
      if (Number.isNaN(itemStart.valueOf()) || Number.isNaN(itemEnd.valueOf())) {
        continue;
      }
      if (itemEnd <= rangeStart || itemStart >= rangeEnd) {
        continue;
      }
      busy.push({
        start: toDate(item.start, 'busy.start').toISOString(),
        end: toDate(item.end, 'busy.end').toISOString(),
        source: item.source || entry.source || 'cache',
        referenceId: item.referenceId || null,
        label: item.label || null
      });
    }
    return busy;
  }

  async #collectBusyFromEvents(organizationId, userId, rangeStart, rangeEnd) {
    if (!this.eventService) {
      return [];
    }
    const events = await this.eventService.listEvents({
      organizationId,
      start: rangeStart.toISOString(),
      end: rangeEnd.toISOString()
    });
    const busy = [];
    for (const event of events) {
      if (!Array.isArray(event.assigneeIds) || !event.assigneeIds.includes(userId)) {
        continue;
      }
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);
      if (eventEnd <= rangeStart || eventStart >= rangeEnd) {
        continue;
      }
      busy.push({
        start: event.start,
        end: event.end,
        source: 'event',
        referenceId: event.id,
        label: event.title || null
      });
    }
    return busy;
  }

  async #collectBusy({ organizationId, userId, rangeStart, rangeEnd }) {
    const [eventBusy, cacheBusy] = await Promise.all([
      this.#collectBusyFromEvents(organizationId, userId, rangeStart, rangeEnd),
      this.#collectBusyFromCache(organizationId, userId, rangeStart, rangeEnd)
    ]);
    return [...eventBusy, ...cacheBusy];
  }

  async getAvailabilityWindows({
    organizationId,
    userIds = [],
    rangeStart,
    rangeEnd,
    slotMinutes = 30
  }) {
    if (!organizationId) {
      const error = new Error('organizationId is required');
      error.code = 'AVAILABILITY_INVALID_ARGUMENT';
      throw error;
    }
    if (!Array.isArray(userIds) || userIds.length === 0) {
      const error = new Error('userIds must be a non-empty array');
      error.code = 'AVAILABILITY_INVALID_ARGUMENT';
      throw error;
    }
    const rangeStartDate = toDate(rangeStart, 'rangeStart');
    const rangeEndDate = toDate(rangeEnd, 'rangeEnd');
    if (rangeStartDate >= rangeEndDate) {
      const error = new Error('rangeEnd must be after rangeStart');
      error.code = 'AVAILABILITY_INVALID_RANGE';
      throw error;
    }
    if (!Number.isFinite(slotMinutes) || slotMinutes <= 0) {
      const error = new Error('slotMinutes must be a positive number');
      error.code = 'AVAILABILITY_INVALID_ARGUMENT';
      throw error;
    }
    const totalMinutes = minutesBetween(rangeStartDate, rangeEndDate);
    const totalSlots = Math.ceil(totalMinutes / slotMinutes);
    const slotAvailability = Array.from({ length: totalSlots }, () => ({
      available: true,
      blockers: []
    }));

    const conflictsByUser = new Map();

    const markConflict = (userId, slotIndex, blocker) => {
      const slotStart = addMinutes(rangeStartDate, slotIndex * slotMinutes);
      const slotEnd = addMinutes(rangeStartDate, (slotIndex + 1) * slotMinutes);
      const list = conflictsByUser.get(userId) || [];
      const previous = list[list.length - 1];
      const sameBlocker =
        previous &&
        previous.source === blocker.source &&
        previous.referenceId === blocker.referenceId &&
        previous.label === blocker.label &&
        previous.end === slotStart.toISOString();
      if (sameBlocker) {
        previous.end = slotEnd.toISOString();
      } else {
        list.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          source: blocker.source,
          referenceId: blocker.referenceId,
          label: blocker.label || null
        });
      }
      conflictsByUser.set(userId, list);
    };

    for (const userId of userIds) {
      const busyEntries = await this.#collectBusy({
        organizationId,
        userId,
        rangeStart: rangeStartDate,
        rangeEnd: rangeEndDate
      });
      for (const busy of busyEntries) {
        const busyStart = new Date(busy.start);
        const busyEnd = new Date(busy.end);
        const startIndex = Math.max(0, Math.floor((busyStart - rangeStartDate) / (slotMinutes * 60 * 1000)));
        const endIndex = Math.min(
          totalSlots,
          Math.ceil((busyEnd - rangeStartDate) / (slotMinutes * 60 * 1000))
        );
        for (let i = startIndex; i < endIndex; i += 1) {
          slotAvailability[i].available = false;
          slotAvailability[i].blockers.push({ userId, ...busy });
          markConflict(userId, i, busy);
        }
      }
    }

    const windows = [];
    let windowStartIndex = null;
    for (let i = 0; i < slotAvailability.length; i += 1) {
      if (slotAvailability[i].available) {
        if (windowStartIndex === null) {
          windowStartIndex = i;
        }
      } else if (windowStartIndex !== null) {
        const start = addMinutes(rangeStartDate, windowStartIndex * slotMinutes);
        const end = addMinutes(rangeStartDate, i * slotMinutes);
        windows.push({
          start: start.toISOString(),
          end: end.toISOString(),
          durationMinutes: minutesBetween(start, end)
        });
        windowStartIndex = null;
      }
    }
    if (windowStartIndex !== null) {
      const start = addMinutes(rangeStartDate, windowStartIndex * slotMinutes);
      const end = addMinutes(rangeStartDate, totalSlots * slotMinutes);
      windows.push({
        start: start.toISOString(),
        end: end.toISOString(),
        durationMinutes: minutesBetween(start, end)
      });
    }

    return {
      windows,
      conflicts: Array.from(conflictsByUser.entries()).map(([userId, intervals]) => ({
        userId,
        intervals
      })),
      generatedAt: this.clock().toISOString()
    };
  }
}

export { AvailabilityService };
