import { randomUUID } from 'node:crypto';

function toDate(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    const error = new Error(`Invalid date for ${field}`);
    error.code = 'SCHEDULING_INVALID_DATE';
    error.field = field;
    throw error;
  }
  return date;
}

function ensureParticipants(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    const error = new Error('userIds must be a non-empty array');
    error.code = 'SCHEDULING_INVALID_ARGUMENT';
    throw error;
  }
  return Array.from(new Set(userIds.filter((id) => typeof id === 'string' && id.trim() !== '')));
}

function cloneJson(value) {
  if (value === undefined) {
    return undefined;
  }
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function cloneSuggestion(suggestion) {
  if (!suggestion) {
    return null;
  }
  return {
    ...suggestion,
    inputSnapshot: cloneJson(suggestion.inputSnapshot) ?? {},
    outputPlan: suggestion.outputPlan
      ? {
          ...suggestion.outputPlan,
          events: Array.isArray(suggestion.outputPlan.events)
            ? suggestion.outputPlan.events.map((event) => ({ ...event }))
            : []
        }
      : null,
    scoreBreakdown: cloneJson(suggestion.scoreBreakdown),
    errors: Array.isArray(suggestion.errors) ? [...suggestion.errors] : [],
    resultingEventIds: Array.isArray(suggestion.resultingEventIds)
      ? [...suggestion.resultingEventIds]
      : [],
    metadata: cloneJson(suggestion.metadata)
  };
}

class InMemorySchedulingSuggestionStore {
  constructor() {
    this.suggestions = new Map();
  }

  async createSuggestion(suggestion) {
    const stored = cloneSuggestion(suggestion);
    this.suggestions.set(stored.id, stored);
    return cloneSuggestion(stored);
  }

  async updateSuggestion(suggestion) {
    const stored = cloneSuggestion(suggestion);
    this.suggestions.set(stored.id, stored);
    return cloneSuggestion(stored);
  }

  async getSuggestion(id) {
    const suggestion = this.suggestions.get(id);
    return suggestion ? cloneSuggestion(suggestion) : null;
  }

  async listSuggestionsForOrg(organizationId) {
    const suggestions = [];
    for (const suggestion of this.suggestions.values()) {
      if (suggestion.organizationId === organizationId) {
        suggestions.push(cloneSuggestion(suggestion));
      }
    }
    suggestions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return suggestions;
  }
}

class SchedulingService {
  constructor({
    idGenerator = randomUUID,
    clock = () => new Date(),
    availabilityService,
    eventService,
    queueService = null,
    metricsService = null,
    store
  } = {}) {
    if (!availabilityService) {
      throw new Error('availabilityService is required');
    }
    if (!eventService) {
      throw new Error('eventService is required');
    }
    this.idGenerator = idGenerator;
    this.clock = clock;
    this.availabilityService = availabilityService;
    this.eventService = eventService;
    this.queueService = queueService;
    this.metricsService = metricsService;
    this.store = store ?? new InMemorySchedulingSuggestionStore();
    this.processing = new Set();
  }

  async runSchedulingJob(payload, { createdBy } = {}) {
    const {
      organizationId,
      userIds,
      rangeStart,
      rangeEnd,
      durationMinutes = 60,
      title = 'Auto generated shift',
      metadata = {}
    } = payload || {};
    if (!organizationId) {
      const error = new Error('organizationId is required');
      error.code = 'SCHEDULING_INVALID_ARGUMENT';
      throw error;
    }
    const participants = ensureParticipants(userIds);
    const rangeStartDate = toDate(rangeStart, 'rangeStart');
    const rangeEndDate = toDate(rangeEnd, 'rangeEnd');
    if (rangeStartDate >= rangeEndDate) {
      const error = new Error('rangeEnd must be after rangeStart');
      error.code = 'SCHEDULING_INVALID_RANGE';
      throw error;
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      const error = new Error('durationMinutes must be a positive number');
      error.code = 'SCHEDULING_INVALID_ARGUMENT';
      throw error;
    }
    const now = this.clock();
    const suggestion = {
      id: this.idGenerator(),
      organizationId,
      solver: metadata.solver || 'heuristic-intersection',
      status: 'PENDING',
      createdBy: createdBy || null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      committedAt: null,
      committedBy: null,
      completedAt: null,
      queueJobId: null,
      inputSnapshot: {
        organizationId,
        userIds: participants,
        rangeStart: rangeStartDate.toISOString(),
        rangeEnd: rangeEndDate.toISOString(),
        durationMinutes,
        title,
        metadata
      },
      outputPlan: null,
      scoreBreakdown: null,
      errors: [],
      resultingEventIds: [],
      metadata: null
    };
    if (this.queueService) {
      try {
        const queueJob = await this.queueService.enqueueJob({
          organizationId,
          type: 'scheduling.generate',
          payload: {
            suggestionId: suggestion.id,
            userIds: participants,
            rangeStart: rangeStartDate.toISOString(),
            rangeEnd: rangeEndDate.toISOString(),
            durationMinutes,
            metadata
          },
          priority: Number.isInteger(metadata.priority) ? metadata.priority : 0,
          maxAttempts:
            Number.isInteger(metadata.maxAttempts) && metadata.maxAttempts > 0
              ? metadata.maxAttempts
              : 3,
          dedupeKey: `scheduling:${suggestion.id}`,
          createdBy
        });
        suggestion.queueJobId = queueJob ? queueJob.id : null;
      } catch (error) {
        suggestion.status = 'FAILED';
        suggestion.errors = [`Queue enqueue failed: ${error.message}`];
        suggestion.scoreBreakdown = { errorCode: error.code || 'QUEUE_ENQUEUE_ERROR' };
        suggestion.updatedAt = this.clock().toISOString();
        await this.store.createSuggestion(suggestion);
        throw error;
      }
    }
    const stored = await this.store.createSuggestion(suggestion);
    this.#enqueueProcessing(stored.id);
    return stored;
  }

  #enqueueProcessing(suggestionId) {
    if (this.processing.has(suggestionId)) {
      return;
    }
    this.processing.add(suggestionId);
    setTimeout(() => {
      Promise.resolve()
        .then(() => this.#processSuggestion(suggestionId))
        .catch(() => {})
        .finally(() => {
          this.processing.delete(suggestionId);
        });
    }, 10).unref?.();
  }

  async #processSuggestion(suggestionId) {
    let suggestion = await this.store.getSuggestion(suggestionId);
    if (!suggestion || suggestion.status !== 'PENDING') {
      return;
    }
    const stopTimer = this.metricsService ? this.metricsService.startTimer() : null;
    let metricsRecorded = false;
    const recordMetrics = (status) => {
      if (!this.metricsService || !stopTimer || metricsRecorded) {
        return;
      }
      metricsRecorded = true;
      const duration = stopTimer();
      const solver = suggestion.solver || 'unknown';
      const normalizedStatus = (status || 'unknown').toString().toLowerCase();
      this.metricsService.observeSummary(
        'scheduling_duration_ms',
        { solver, status: normalizedStatus },
        duration,
        { help: 'Scheduling solver execution duration grouped by solver and outcome' }
      );
      this.metricsService.incrementCounter(
        'scheduling_jobs_total',
        { solver, status: normalizedStatus },
        1,
        { help: 'Number of scheduling jobs grouped by solver and outcome' }
      );
    };

    const applyUpdate = async (mutator) => {
      const draft = cloneSuggestion(suggestion);
      mutator(draft);
      draft.updatedAt = this.clock().toISOString();
      suggestion = await this.store.updateSuggestion(draft);
      return suggestion;
    };

    let queueJobStarted = false;
    if (this.queueService && suggestion.queueJobId) {
      const job = await this.queueService.getJob(suggestion.queueJobId);
      if (job && job.status === 'CANCELLED') {
        await applyUpdate((draft) => {
          draft.status = 'FAILED';
          draft.errors = ['Scheduling job was cancelled'];
          draft.scoreBreakdown = { errorCode: 'QUEUE_CANCELLED' };
          draft.completedAt = null;
        });
        recordMetrics('FAILED');
        return;
      }
      try {
        await this.queueService.startJob(suggestion.queueJobId, {
          workerId: 'scheduling-service'
        });
        queueJobStarted = true;
      } catch (error) {
        await applyUpdate((draft) => {
          draft.status = 'FAILED';
          draft.errors = [`Queue start failed: ${error.message}`];
          draft.scoreBreakdown = { errorCode: error.code || 'QUEUE_START_ERROR' };
          draft.completedAt = null;
        });
        recordMetrics('FAILED');
        return;
      }
    }

    try {
      const availability = await this.availabilityService.getAvailabilityWindows({
        organizationId: suggestion.organizationId,
        userIds: suggestion.inputSnapshot.userIds,
        rangeStart: suggestion.inputSnapshot.rangeStart,
        rangeEnd: suggestion.inputSnapshot.rangeEnd,
        slotMinutes: Math.min(30, suggestion.inputSnapshot.durationMinutes)
      });
      const feasible = availability.windows.filter(
        (window) => window.durationMinutes >= suggestion.inputSnapshot.durationMinutes
      );
      if (feasible.length === 0) {
        suggestion = await applyUpdate((draft) => {
          draft.status = 'FAILED';
          draft.errors = ['No feasible windows for requested duration'];
          draft.scoreBreakdown = {
            feasibleWindows: 0,
            conflictsConsidered: availability.conflicts.length
          };
          draft.completedAt = null;
        });
      } else {
        const selected = feasible[0];
        const eventStart = new Date(selected.start);
        const eventEnd = new Date(
          eventStart.getTime() + suggestion.inputSnapshot.durationMinutes * 60 * 1000
        );
        suggestion = await applyUpdate((draft) => {
          draft.status = 'READY';
          draft.outputPlan = {
            selectedWindow: selected,
            events: [
              {
                title: suggestion.inputSnapshot.title || 'Auto generated shift',
                start: eventStart.toISOString(),
                end: eventEnd.toISOString(),
                assigneeIds: suggestion.inputSnapshot.userIds,
                color: suggestion.inputSnapshot.metadata?.color || null,
                metadata: suggestion.inputSnapshot.metadata || {}
              }
            ]
          };
          draft.scoreBreakdown = {
            feasibleWindows: feasible.length,
            selectedWindowIndex: 0,
            windowCoverageMinutes: selected.durationMinutes,
            requestedDurationMinutes: suggestion.inputSnapshot.durationMinutes
          };
          draft.errors = [];
          draft.completedAt = this.clock().toISOString();
        });
      }
    } catch (error) {
      suggestion = await applyUpdate((draft) => {
        draft.status = 'FAILED';
        draft.errors = [error.message];
        draft.scoreBreakdown = { errorCode: error.code || 'UNKNOWN' };
        draft.completedAt = null;
      });
    }

    recordMetrics(suggestion.status);

    if (this.queueService && suggestion.queueJobId && queueJobStarted) {
      try {
        if (suggestion.status === 'READY') {
          await this.queueService.completeJob(suggestion.queueJobId, {
            workerId: 'scheduling-service',
            result: { suggestionId: suggestion.id, status: suggestion.status }
          });
        } else if (suggestion.status === 'FAILED') {
          const error = suggestion.errors[0] || 'Unknown scheduling failure';
          await this.queueService.failJob(suggestion.queueJobId, {
            workerId: 'scheduling-service',
            error,
            retryable: false
          });
        }
      } catch (error) {
        // Ignore queue completion errors and rely on stored suggestion state.
      }
    }
  }

  async getSuggestion(suggestionId) {
    if (!suggestionId) {
      return null;
    }
    return this.store.getSuggestion(suggestionId);
  }

  async listSuggestionsForOrg(organizationId) {
    return this.store.listSuggestionsForOrg(organizationId);
  }

  async commitSuggestion(suggestionId, { actorId, eventOverrides = [] } = {}) {
    let suggestion = await this.store.getSuggestion(suggestionId);
    if (!suggestion) {
      const error = new Error('Suggestion not found');
      error.code = 'SCHEDULING_NOT_FOUND';
      throw error;
    }
    if (suggestion.status !== 'READY') {
      const error = new Error('Suggestion is not ready for commit');
      error.code = 'SCHEDULING_NOT_READY';
      throw error;
    }
    if (!Array.isArray(suggestion.outputPlan?.events) || suggestion.outputPlan.events.length === 0) {
      const error = new Error('Suggestion has no events to commit');
      error.code = 'SCHEDULING_EMPTY_PLAN';
      throw error;
    }
    const overridesByIndex = new Map();
    for (const override of eventOverrides) {
      if (!override || typeof override.index !== 'number') {
        continue;
      }
      overridesByIndex.set(override.index, override);
    }
    const createdEvents = [];
    for (let index = 0; index < suggestion.outputPlan.events.length; index += 1) {
      const eventDraft = suggestion.outputPlan.events[index];
      const override = overridesByIndex.get(index);
      const payload = {
        organizationId: suggestion.organizationId,
        title: override?.title || eventDraft.title,
        start: override?.start || eventDraft.start,
        end: override?.end || eventDraft.end,
        color: override?.color ?? eventDraft.color ?? null,
        description: override?.description || null,
        assigneeIds: Array.isArray(override?.assigneeIds)
          ? override.assigneeIds
          : eventDraft.assigneeIds,
        createdBy: actorId || suggestion.createdBy
      };
      const created = await this.eventService.createEvent(payload);
      createdEvents.push(created);
    }
    const now = this.clock().toISOString();
    suggestion = await this.store.updateSuggestion({
      ...suggestion,
      status: 'COMMITTED',
      committedAt: now,
      committedBy: actorId || suggestion.createdBy,
      updatedAt: now,
      resultingEventIds: createdEvents.map((event) => event.id)
    });
    return {
      suggestion,
      events: createdEvents.map((event) => ({ ...event }))
    };
  }
}

export { SchedulingService, InMemorySchedulingSuggestionStore };
