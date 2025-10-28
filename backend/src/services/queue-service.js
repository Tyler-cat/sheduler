import { randomUUID } from 'node:crypto';

function assertString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    const error = new Error(`${field} is required`);
    error.code = 'QUEUE_INVALID_ARGUMENT';
    error.field = field;
    throw error;
  }
  return value.trim();
}

function clonePayload(payload) {
  if (payload === null || payload === undefined) {
    return null;
  }
  return JSON.parse(JSON.stringify(payload));
}

function cloneJob(job) {
  if (!job) {
    return null;
  }
  return {
    ...job,
    payload: job.payload ? clonePayload(job.payload) || {} : {},
    result: job.result ? clonePayload(job.result) : null,
    errorHistory: Array.isArray(job.errorHistory)
      ? job.errorHistory.map((entry) => ({ ...entry }))
      : []
  };
}

class InMemoryQueueStore {
  constructor() {
    this.jobs = new Map();
  }

  async create(job) {
    const stored = cloneJob(job);
    this.jobs.set(stored.id, stored);
    return cloneJob(stored);
  }

  async update(job) {
    if (!job || !job.id) {
      throw new Error('job id is required for update');
    }
    const stored = cloneJob(job);
    this.jobs.set(stored.id, stored);
    return cloneJob(stored);
  }

  async get(jobId) {
    const job = this.jobs.get(jobId);
    return cloneJob(job);
  }

  async list({ organizationId = null, status = null, limit = 50 } = {}) {
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 50;
    const results = [];
    for (const job of this.jobs.values()) {
      if (organizationId && job.organizationId !== organizationId) {
        continue;
      }
      if (status && job.status !== status) {
        continue;
      }
      results.push(job);
    }
    results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return results.slice(0, normalizedLimit).map((job) => cloneJob(job));
  }

  async findActiveByDedupe(dedupeKey) {
    if (!dedupeKey) {
      return null;
    }
    for (const job of this.jobs.values()) {
      if (job.dedupeKey === dedupeKey && job.status === 'QUEUED') {
        return cloneJob(job);
      }
    }
    return null;
  }

  async getQueuedCounts() {
    const counts = new Map();
    for (const job of this.jobs.values()) {
      if (job.status === 'QUEUED') {
        counts.set(job.type, (counts.get(job.type) || 0) + 1);
      }
    }
    return counts;
  }
}

class QueueService {
  constructor({
    idGenerator = randomUUID,
    clock = () => new Date(),
    metricsService = null,
    auditService = null,
    store = null
  } = {}) {
    this.idGenerator = idGenerator;
    this.clock = clock;
    this.metricsService = metricsService;
    this.auditService = auditService;
    this.store = store || new InMemoryQueueStore();
    this.backlogGaugeState = new Map();
  }

  #registerMetric(name, labels, value, help) {
    if (!this.metricsService) {
      return;
    }
    this.metricsService.incrementCounter(name, labels, value, { help });
  }

  async #updateBacklogMetrics() {
    if (!this.metricsService) {
      return;
    }
    const counts = await this.store.getQueuedCounts();
    const previous = this.backlogGaugeState;
    const seen = new Set();
    for (const [type, value] of counts.entries()) {
      this.metricsService.setGauge(
        'queue_backlog_total',
        { type },
        value,
        { help: 'Number of queued jobs awaiting processing grouped by type' }
      );
      seen.add(type);
    }
    for (const [type] of previous.entries()) {
      if (!seen.has(type)) {
        this.metricsService.setGauge(
          'queue_backlog_total',
          { type },
          0,
          { help: 'Number of queued jobs awaiting processing grouped by type' }
        );
      }
    }
    this.backlogGaugeState = new Map(counts);
  }

  #recordAudit({ actorId, action, organizationId, subjectId, metadata, sensitiveFields = [] }) {
    if (!this.auditService) {
      return;
    }
    this.auditService.record({
      actorId,
      action,
      subjectType: 'queueJob',
      subjectId,
      organizationId,
      metadata,
      sensitiveFields
    });
  }

  async enqueueJob({
    organizationId,
    type,
    payload = {},
    priority = 0,
    maxAttempts = 3,
    dedupeKey = null,
    createdBy = null
  } = {}) {
    const orgId = assertString(organizationId, 'organizationId');
    const jobType = assertString(type, 'type');
    if (!Number.isInteger(priority)) {
      const error = new Error('priority must be an integer');
      error.code = 'QUEUE_INVALID_ARGUMENT';
      error.field = 'priority';
      throw error;
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
      const error = new Error('maxAttempts must be a positive integer');
      error.code = 'QUEUE_INVALID_ARGUMENT';
      error.field = 'maxAttempts';
      throw error;
    }

    const dedupe = typeof dedupeKey === 'string' && dedupeKey.trim() !== '' ? dedupeKey.trim() : null;
    if (dedupe) {
      const existing = await this.store.findActiveByDedupe(dedupe);
      if (existing) {
        return existing;
      }
    }

    const nowIso = this.clock().toISOString();
    const job = {
      id: this.idGenerator(),
      organizationId: orgId,
      type: jobType,
      payload: clonePayload(payload) || {},
      priority,
      status: 'QUEUED',
      attempts: 0,
      maxAttempts,
      dedupeKey: dedupe,
      createdBy: createdBy || null,
      createdAt: nowIso,
      updatedAt: nowIso,
      queuedAt: nowIso,
      startedAt: null,
      completedAt: null,
      workerId: null,
      result: null,
      lastError: null,
      errorHistory: []
    };
    const stored = await this.store.create(job);
    this.#registerMetric(
      'queue_jobs_enqueued_total',
      { type: stored.type },
      1,
      'Number of jobs enqueued grouped by type'
    );
    await this.#updateBacklogMetrics();
    this.#recordAudit({
      actorId: createdBy,
      action: 'queue.enqueue',
      organizationId: stored.organizationId,
      subjectId: stored.id,
      metadata: {
        type: stored.type,
        priority: stored.priority,
        dedupeKey: stored.dedupeKey,
        maxAttempts: stored.maxAttempts
      }
    });
    return stored;
  }

  async startJob(jobId, { workerId } = {}) {
    const job = await this.store.get(jobId);
    if (!job) {
      const error = new Error('Job not found');
      error.code = 'QUEUE_NOT_FOUND';
      throw error;
    }
    if (job.status !== 'QUEUED') {
      const error = new Error('Job is not queued');
      error.code = 'QUEUE_INVALID_STATE';
      throw error;
    }
    const nowIso = this.clock().toISOString();
    const updated = await this.store.update({
      ...job,
      status: 'RUNNING',
      workerId: workerId || null,
      startedAt: nowIso,
      updatedAt: nowIso,
      attempts: (job.attempts || 0) + 1
    });
    this.#registerMetric(
      'queue_jobs_started_total',
      { type: updated.type },
      1,
      'Number of jobs started grouped by type'
    );
    await this.#updateBacklogMetrics();
    return updated;
  }

  async completeJob(jobId, { workerId = null, result = null } = {}) {
    const job = await this.store.get(jobId);
    if (!job) {
      const error = new Error('Job not found');
      error.code = 'QUEUE_NOT_FOUND';
      throw error;
    }
    if (job.status !== 'RUNNING') {
      const error = new Error('Job is not running');
      error.code = 'QUEUE_INVALID_STATE';
      throw error;
    }
    const nowIso = this.clock().toISOString();
    const updated = await this.store.update({
      ...job,
      status: 'COMPLETED',
      workerId: workerId || job.workerId || null,
      completedAt: nowIso,
      updatedAt: nowIso,
      result: clonePayload(result)
    });
    this.#registerMetric(
      'queue_jobs_completed_total',
      { type: updated.type },
      1,
      'Number of jobs completed grouped by type'
    );
    await this.#updateBacklogMetrics();
    return updated;
  }

  async failJob(jobId, { workerId = null, error, retryable = false } = {}) {
    const job = await this.store.get(jobId);
    if (!job) {
      const notFound = new Error('Job not found');
      notFound.code = 'QUEUE_NOT_FOUND';
      throw notFound;
    }
    if (job.status !== 'RUNNING') {
      const invalid = new Error('Job is not running');
      invalid.code = 'QUEUE_INVALID_STATE';
      throw invalid;
    }
    const nowIso = this.clock().toISOString();
    const message = error instanceof Error ? error.message : String(error || 'Unknown error');
    const history = Array.isArray(job.errorHistory) ? [...job.errorHistory] : [];
    history.push({ attempt: job.attempts, message, at: nowIso });
    let nextStatus;
    let completedAt = job.completedAt;
    let queuedAt = job.queuedAt;
    let startedAt = job.startedAt;
    let worker = workerId || job.workerId || null;
    if (retryable && job.attempts < job.maxAttempts) {
      nextStatus = 'QUEUED';
      queuedAt = nowIso;
      startedAt = null;
      completedAt = null;
      worker = null;
      this.#registerMetric(
        'queue_jobs_requeued_total',
        { type: job.type },
        1,
        'Number of jobs automatically requeued after failure'
      );
    } else {
      nextStatus = retryable ? 'DEAD_LETTER' : 'FAILED';
      completedAt = nowIso;
    }
    const updated = await this.store.update({
      ...job,
      status: nextStatus,
      workerId: worker,
      updatedAt: nowIso,
      queuedAt,
      startedAt,
      completedAt,
      lastError: message,
      errorHistory: history
    });
    this.#registerMetric(
      'queue_jobs_failed_total',
      { type: updated.type },
      1,
      'Number of jobs failed grouped by type'
    );
    await this.#updateBacklogMetrics();
    return updated;
  }

  async retryJob(jobId, { actorId = null } = {}) {
    const job = await this.store.get(jobId);
    if (!job) {
      const error = new Error('Job not found');
      error.code = 'QUEUE_NOT_FOUND';
      throw error;
    }
    if (!['FAILED', 'DEAD_LETTER', 'CANCELLED'].includes(job.status)) {
      const invalid = new Error('Job cannot be retried from current state');
      invalid.code = 'QUEUE_INVALID_STATE';
      throw invalid;
    }
    const nowIso = this.clock().toISOString();
    const updated = await this.store.update({
      ...job,
      status: 'QUEUED',
      updatedAt: nowIso,
      queuedAt: nowIso,
      startedAt: null,
      completedAt: null,
      workerId: null
    });
    this.#registerMetric(
      'queue_jobs_manual_requeued_total',
      { type: updated.type },
      1,
      'Number of jobs manually requeued grouped by type'
    );
    this.#recordAudit({
      actorId,
      action: 'queue.retry',
      organizationId: updated.organizationId,
      subjectId: updated.id,
      metadata: { status: updated.status }
    });
    await this.#updateBacklogMetrics();
    return updated;
  }

  async cancelJob(jobId, { actorId = null, reason = null } = {}) {
    const job = await this.store.get(jobId);
    if (!job) {
      const error = new Error('Job not found');
      error.code = 'QUEUE_NOT_FOUND';
      throw error;
    }
    if (['COMPLETED', 'CANCELLED'].includes(job.status)) {
      const invalid = new Error('Job is already finalized');
      invalid.code = 'QUEUE_INVALID_STATE';
      throw invalid;
    }
    const nowIso = this.clock().toISOString();
    const updated = await this.store.update({
      ...job,
      status: 'CANCELLED',
      updatedAt: nowIso,
      completedAt: nowIso,
      workerId: null,
      result: null,
      lastError: reason || null
    });
    this.#registerMetric(
      'queue_jobs_cancelled_total',
      { type: updated.type },
      1,
      'Number of jobs cancelled grouped by type'
    );
    this.#recordAudit({
      actorId,
      action: 'queue.cancel',
      organizationId: updated.organizationId,
      subjectId: updated.id,
      metadata: { reason }
    });
    await this.#updateBacklogMetrics();
    return updated;
  }

  async getJob(jobId) {
    if (!jobId) {
      return null;
    }
    return this.store.get(jobId);
  }

  async listJobs({ organizationId = null, status = null, limit = 50 } = {}) {
    return this.store.list({ organizationId, status, limit });
  }
}

export { QueueService, InMemoryQueueStore };
