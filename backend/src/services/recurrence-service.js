import { randomUUID } from 'node:crypto';

const WEEKDAY_MAP = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6
};

function parseRrule(rrule) {
  if (typeof rrule !== 'string' || !rrule.trim()) {
    const error = new Error('rrule must be a non-empty string');
    error.code = 'RECURRENCE_INVALID_RULE';
    throw error;
  }
  const parts = rrule
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  const config = {
    frequency: null,
    interval: 1,
    byWeekday: null,
    count: null,
    until: null
  };
  for (const part of parts) {
    const [rawKey, rawValue] = part.split('=');
    if (!rawKey || typeof rawValue === 'undefined') {
      continue;
    }
    const key = rawKey.trim().toUpperCase();
    const value = rawValue.trim();
    switch (key) {
      case 'FREQ':
        config.frequency = value.toUpperCase();
        break;
      case 'INTERVAL': {
        const interval = Number.parseInt(value, 10);
        if (!Number.isFinite(interval) || interval <= 0) {
          const error = new Error('interval must be a positive integer');
          error.code = 'RECURRENCE_INVALID_RULE';
          throw error;
        }
        config.interval = interval;
        break;
      }
      case 'BYDAY': {
        const days = value
          .split(',')
          .map((item) => item.trim().toUpperCase())
          .filter(Boolean);
        if (days.some((day) => !(day in WEEKDAY_MAP))) {
          const error = new Error('Unsupported BYDAY value');
          error.code = 'RECURRENCE_INVALID_RULE';
          throw error;
        }
        config.byWeekday = days;
        break;
      }
      case 'COUNT': {
        const count = Number.parseInt(value, 10);
        if (!Number.isFinite(count) || count <= 0) {
          const error = new Error('count must be a positive integer');
          error.code = 'RECURRENCE_INVALID_RULE';
          throw error;
        }
        config.count = count;
        break;
      }
      case 'UNTIL': {
        const untilDate = new Date(value);
        if (Number.isNaN(untilDate.valueOf())) {
          const error = new Error('until must be a valid date');
          error.code = 'RECURRENCE_INVALID_RULE';
          throw error;
        }
        config.until = untilDate;
        break;
      }
      default:
        // ignore unsupported attributes but continue parsing known ones
        break;
    }
  }
  if (!config.frequency) {
    const error = new Error('FREQ is required in rrule');
    error.code = 'RECURRENCE_INVALID_RULE';
    throw error;
  }
  if (!['DAILY', 'WEEKLY'].includes(config.frequency)) {
    const error = new Error(`Unsupported frequency ${config.frequency}`);
    error.code = 'RECURRENCE_UNSUPPORTED_FREQUENCY';
    throw error;
  }
  return config;
}

function normalizeExdates(exdates) {
  if (exdates === undefined) {
    return [];
  }
  if (!Array.isArray(exdates)) {
    const error = new Error('exdates must be an array');
    error.code = 'RECURRENCE_INVALID_EXDATES';
    throw error;
  }
  const normalized = [];
  for (const date of exdates) {
    if (typeof date !== 'string') {
      const error = new Error('exdate must be a string');
      error.code = 'RECURRENCE_INVALID_EXDATES';
      throw error;
    }
    const parsed = new Date(date);
    if (Number.isNaN(parsed.valueOf())) {
      const error = new Error(`Invalid exdate: ${date}`);
      error.code = 'RECURRENCE_INVALID_EXDATES';
      throw error;
    }
    normalized.push(parsed.toISOString());
  }
  return Array.from(new Set(normalized));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function minutesBetween(start, end) {
  return (end.getTime() - start.getTime()) / (60 * 1000);
}

class RecurrenceService {
  constructor({ idGenerator = randomUUID, clock = () => new Date(), eventService } = {}) {
    if (!eventService) {
      throw new Error('eventService is required');
    }
    this.idGenerator = idGenerator;
    this.clock = clock;
    this.eventService = eventService;
    this.rulesByEvent = new Map();
    this.rulesByOrg = new Map();
  }

  #orgSet(orgId) {
    if (!this.rulesByOrg.has(orgId)) {
      this.rulesByOrg.set(orgId, new Set());
    }
    return this.rulesByOrg.get(orgId);
  }

  getRecurrence(eventId) {
    const record = this.rulesByEvent.get(eventId);
    if (!record) {
      return null;
    }
    return {
      ...record,
      exdates: record.exdates.slice()
    };
  }

  listRecurrencesForOrg(organizationId) {
    const result = [];
    const set = this.rulesByOrg.get(organizationId);
    if (!set) {
      return result;
    }
    for (const eventId of set) {
      const rule = this.getRecurrence(eventId);
      if (rule) {
        result.push(rule);
      }
    }
    result.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return result;
  }

  async setRecurrence(eventId, payload = {}, { actorId } = {}) {
    const event = await this.eventService.getEvent(eventId);
    if (!event) {
      const error = new Error('Event not found');
      error.code = 'RECURRENCE_EVENT_NOT_FOUND';
      throw error;
    }
    const { rrule, exdates = [], interval } = payload;
    const parsed = parseRrule(rrule);
    const normalizedExdates = normalizeExdates(exdates);
    const resolvedInterval = interval ?? parsed.interval;
    if (!Number.isFinite(resolvedInterval) || resolvedInterval <= 0) {
      const error = new Error('interval must be a positive integer');
      error.code = 'RECURRENCE_INVALID_INTERVAL';
      throw error;
    }
    const now = this.clock();
    const existing = this.rulesByEvent.get(eventId);
    const record = {
      id: existing?.id || this.idGenerator(),
      eventId,
      organizationId: event.organizationId,
      rrule,
      interval: resolvedInterval,
      exdates: normalizedExdates,
      createdAt: existing?.createdAt || now.toISOString(),
      updatedAt: now.toISOString(),
      createdBy: existing?.createdBy || actorId || null,
      updatedBy: actorId || existing?.updatedBy || null
    };
    this.rulesByEvent.set(eventId, record);
    this.#orgSet(event.organizationId).add(eventId);
    return this.getRecurrence(eventId);
  }

  removeRecurrence(eventId) {
    const existing = this.rulesByEvent.get(eventId);
    if (!existing) {
      return null;
    }
    this.rulesByEvent.delete(eventId);
    const set = this.rulesByOrg.get(existing.organizationId);
    if (set) {
      set.delete(eventId);
      if (set.size === 0) {
        this.rulesByOrg.delete(existing.organizationId);
      }
    }
    return { ...existing, exdates: existing.exdates.slice() };
  }

  async expandOccurrences(eventId, { rangeStart, rangeEnd, maxOccurrences = 200 } = {}) {
    const rule = this.rulesByEvent.get(eventId);
    if (!rule) {
      const error = new Error('Recurrence not found');
      error.code = 'RECURRENCE_NOT_FOUND';
      throw error;
    }
    const event = await this.eventService.getEvent(eventId);
    if (!event) {
      const error = new Error('Event not found');
      error.code = 'RECURRENCE_EVENT_NOT_FOUND';
      throw error;
    }
    const parsed = parseRrule(rule.rrule);
    const baseStart = new Date(event.start);
    const baseEnd = new Date(event.end);
    const durationMinutes = minutesBetween(baseStart, baseEnd);
    if (durationMinutes <= 0) {
      const error = new Error('Event duration must be positive to expand recurrence');
      error.code = 'RECURRENCE_INVALID_EVENT';
      throw error;
    }
    const startBoundary = rangeStart ? new Date(rangeStart) : baseStart;
    const endBoundary = rangeEnd ? new Date(rangeEnd) : addDays(baseStart, 365);
    if (Number.isNaN(startBoundary.valueOf()) || Number.isNaN(endBoundary.valueOf())) {
      const error = new Error('rangeStart and rangeEnd must be valid dates');
      error.code = 'RECURRENCE_INVALID_RANGE';
      throw error;
    }
    if (startBoundary >= endBoundary) {
      const error = new Error('rangeEnd must be after rangeStart');
      error.code = 'RECURRENCE_INVALID_RANGE';
      throw error;
    }
    const excluded = new Set(rule.exdates.map((value) => new Date(value).getTime()));
    const occurrences = [];
    const maxIterations = 5000;
    let iterations = 0;
    let generatedCount = 0;
    let current = new Date(baseStart);

    if (parsed.frequency === 'DAILY' && startBoundary > baseStart) {
      const diffDays = Math.floor((startBoundary - baseStart) / (24 * 60 * 60 * 1000));
      const skipped = Math.floor(diffDays / parsed.interval);
      current = addDays(baseStart, skipped * parsed.interval);
      while (current < startBoundary) {
        current = addDays(current, parsed.interval);
      }
    }

    while (current <= endBoundary && occurrences.length < maxOccurrences && iterations < maxIterations) {
      iterations += 1;
      if (parsed.count && generatedCount >= parsed.count) {
        break;
      }
      if (parsed.until && current > parsed.until) {
        break;
      }
      const startTime = current.getTime();
      if (startTime >= startBoundary.getTime()) {
        let include = false;
        if (parsed.frequency === 'DAILY') {
          include = ((startTime - baseStart.getTime()) / (24 * 60 * 60 * 1000)) % parsed.interval === 0;
        } else if (parsed.frequency === 'WEEKLY') {
          const diffDays = Math.floor((startTime - baseStart.getTime()) / (24 * 60 * 60 * 1000));
          const diffWeeks = Math.floor(diffDays / 7);
          if (diffWeeks % parsed.interval === 0) {
            const weekday = current.getUTCDay();
            const allowedWeekdays = parsed.byWeekday
              ? parsed.byWeekday.map((code) => WEEKDAY_MAP[code])
              : [baseStart.getUTCDay()];
            include = allowedWeekdays.includes(weekday);
          }
        }
        if (include && !excluded.has(startTime)) {
          occurrences.push({
            start: current.toISOString(),
            end: new Date(current.getTime() + durationMinutes * 60 * 1000).toISOString()
          });
          generatedCount += 1;
        }
      }
      if (parsed.frequency === 'DAILY') {
        current = addDays(current, parsed.interval);
      } else if (parsed.frequency === 'WEEKLY') {
        current = addDays(current, 1);
      }
    }
    return { occurrences, truncated: iterations >= maxIterations || occurrences.length >= maxOccurrences };
  }
}

export { RecurrenceService };
