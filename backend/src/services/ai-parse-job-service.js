import { randomUUID } from 'node:crypto';

const JOB_STATUS = {
  pending: 'PENDING',
  running: 'RUNNING',
  succeeded: 'SUCCEEDED',
  failed: 'FAILED',
  needsReview: 'NEEDS_REVIEW'
};

const REVIEW_DECISION = {
  approved: 'APPROVED',
  rejected: 'REJECTED'
};

function cloneJob(job) {
  return JSON.parse(JSON.stringify(job));
}

class InMemoryParseJobClient {
  constructor({
    providerHandlers = {},
    clock = () => new Date()
  } = {}) {
    this.providerHandlers = providerHandlers;
    this.clock = clock;
    this.jobs = new Map();
    this.statusListeners = new Set();
  }

  async submitJob({ organizationId, creatorId, provider, sourceUrl }) {
    if (!organizationId) {
      throw new Error('organizationId is required');
    }
    if (!creatorId) {
      throw new Error('creatorId is required');
    }
    if (!provider) {
      throw new Error('provider is required');
    }
    if (!sourceUrl) {
      throw new Error('sourceUrl is required');
    }
    const id = randomUUID();
    const now = this.clock().toISOString();
    const job = {
      id,
      orgId: organizationId,
      creatorId,
      provider,
      sourceUrl,
      createdAt: now,
      status: JOB_STATUS.pending,
      events: [],
      error: null,
      metadata: {
        executedToolCalls: [],
        approvalNotifications: []
      }
    };
    this.jobs.set(id, job);
    queueMicrotask(() => {
      const stored = this.jobs.get(id);
      if (!stored) {
        return;
      }
      stored.status = JOB_STATUS.running;
      stored.metadata.startedAt = this.clock().toISOString();
      const handler = this.providerHandlers[provider] || defaultProviderHandler(provider);
      Promise.resolve()
        .then(() => handler({ sourceUrl, organizationId }))
        .then((events) => {
          stored.events = Array.isArray(events) ? events : [];
          const needsReview = stored.events.some((event) => Number(event.confidence) < 0.6);
          stored.status = needsReview ? JOB_STATUS.needsReview : JOB_STATUS.succeeded;
          stored.metadata.completedAt = this.clock().toISOString();
          this.#emitStatus(stored);
        })
        .catch((error) => {
          stored.status = JOB_STATUS.failed;
          stored.error = error && error.message ? error.message : 'Parse failed';
          stored.metadata.failedAt = this.clock().toISOString();
          this.#emitStatus(stored);
        });
    });
    return cloneJob(job);
  }

  async listJobs({ organizationId }) {
    const jobs = Array.from(this.jobs.values()).filter((job) => job.orgId === organizationId);
    jobs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return jobs.map(cloneJob);
  }

  async getJob(jobId) {
    const job = this.jobs.get(jobId);
    return job ? cloneJob(job) : null;
  }

  async reviewJob({ jobId, decision }) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
    if (![JOB_STATUS.succeeded, JOB_STATUS.needsReview].includes(job.status)) {
      return cloneJob(job);
    }
    if (decision === REVIEW_DECISION.approved) {
      job.metadata.review = 'approved';
      job.status = JOB_STATUS.succeeded;
    } else if (decision === REVIEW_DECISION.rejected) {
      job.metadata.review = 'rejected';
      job.status = JOB_STATUS.failed;
    }
    job.metadata.reviewedAt = this.clock().toISOString();
    this.#emitStatus(job);
    return cloneJob(job);
  }

  async updateJob(jobId, { metadata }) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
    if (metadata && typeof metadata === 'object') {
      job.metadata = {
        ...job.metadata,
        ...metadata
      };
    }
    return cloneJob(job);
  }

  onStatusChange(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  #emitStatus(job) {
    if (!this.statusListeners.size) {
      return;
    }
    const snapshot = cloneJob(job);
    for (const listener of this.statusListeners) {
      try {
        listener(snapshot);
      } catch (error) {
        // ignore listener errors to avoid breaking job lifecycle
      }
    }
  }
}

function defaultProviderHandler(label) {
  return ({ sourceUrl }) => {
    const seed = Math.abs(hashString(`${label}:${sourceUrl}`));
    const confidence = Number(((seed % 40) / 100 + 0.55).toFixed(2));
    const toolCalls = [];
    if (confidence < 0.65) {
      toolCalls.push({
        type: 'notify_admin',
        payload: { reason: 'low_confidence', sourceUrl },
        needsApproval: false
      });
    }
    return [
      {
        title: `Auto Generated (${label})`,
        weekday: (seed % 5) + 1,
        start: '09:00',
        end: '10:30',
        location: 'Room 101',
        assignees: ['instructor-1'],
        confidence,
        toolCalls
      }
    ];
  };
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}

class AiParseJobService {
  constructor({
    client = new InMemoryParseJobClient(),
    toolService = null,
    organizationService = null,
    metricsService = null,
    auditService = null,
    notificationService = null
  } = {}) {
    this.client = client;
    this.toolService = toolService;
    this.organizationService = organizationService;
    this.metricsService = metricsService;
    this.auditService = auditService;
    this.notificationService = notificationService;
    if (this.metricsService && typeof this.client.onStatusChange === 'function') {
      this.client.onStatusChange((job) => this.#recordJobMetrics(job));
    }
  }

  async submitJob({ organizationId, provider, sourceUrl, actorId }) {
    const job = await this.client.submitJob({
      organizationId,
      creatorId: actorId,
      provider,
      sourceUrl
    });
    if (this.metricsService) {
      this.metricsService.incrementCounter(
        'ai_jobs_submitted_total',
        { provider },
        1,
        { help: 'Number of AI parse jobs submitted grouped by provider' }
      );
    }
    if (this.auditService) {
      this.auditService.record({
        actorId,
        action: 'ai.parse_job.submit',
        subjectType: 'ai_parse_job',
        subjectId: job.id,
        organizationId,
        metadata: {
          provider,
          sourceUrl
        },
        sensitiveFields: ['sourceUrl']
      });
    }
    return job;
  }

  async listJobs({ organizationId }) {
    const jobs = await this.client.listJobs({ organizationId });
    const processed = [];
    for (const job of jobs) {
      processed.push(await this.#processJob(job, { organizationId }));
    }
    return processed;
  }

  async getJob(jobId, { organizationId, actorId } = {}) {
    const job = await this.client.getJob(jobId);
    if (!job || job.orgId !== organizationId) {
      return null;
    }
    return this.#processJob(job, { organizationId, actorId });
  }

  async reviewJob(jobId, decision, { organizationId, actorId } = {}) {
    const normalizedDecision = decision === REVIEW_DECISION.approved ? REVIEW_DECISION.approved : REVIEW_DECISION.rejected;
    const job = await this.client.reviewJob({ jobId, decision: normalizedDecision });
    if (!job || job.orgId !== organizationId) {
      return null;
    }
    if (this.metricsService) {
      this.metricsService.incrementCounter(
        'ai_jobs_reviewed_total',
        { decision: normalizedDecision },
        1,
        { help: 'Number of AI parse jobs reviewed grouped by decision' }
      );
    }
    if (this.auditService) {
      this.auditService.record({
        actorId,
        action: 'ai.parse_job.review',
        subjectType: 'ai_parse_job',
        subjectId: job.id,
        organizationId,
        metadata: { decision: normalizedDecision }
      });
    }
    return job;
  }

  async #processJob(job, { organizationId, actorId } = {}) {
    if (!job || job.orgId !== organizationId) {
      return null;
    }
    if (!this.toolService || !Array.isArray(job.events) || job.events.length === 0) {
      return job;
    }
    if (![JOB_STATUS.succeeded, JOB_STATUS.needsReview].includes(job.status)) {
      return job;
    }
    const executed = new Set(Array.isArray(job.metadata?.executedToolCalls) ? job.metadata.executedToolCalls : []);
    const notified = new Set(
      Array.isArray(job.metadata?.approvalNotifications) ? job.metadata.approvalNotifications : []
    );
    let metadataChanged = false;
    for (let eventIndex = 0; eventIndex < job.events.length; eventIndex += 1) {
      const event = job.events[eventIndex];
      if (!Array.isArray(event.toolCalls) || event.toolCalls.length === 0) {
        continue;
      }
      for (let callIndex = 0; callIndex < event.toolCalls.length; callIndex += 1) {
        const call = event.toolCalls[callIndex];
        const key = `${eventIndex}:${callIndex}:${JSON.stringify(call)}`;
        if (call.needsApproval) {
          if (!notified.has(key) && this.notificationService && this.organizationService) {
            const adminRecipients = await this.organizationService.listAdmins(organizationId);
            const message =
              typeof call.payload?.reason === 'string'
                ? `AI 解析结果需要审批: ${call.payload.reason}`
                : `AI 解析结果需要审批，工具 ${call.type}`;
            await this.notificationService.createNotification({
              organizationId,
              recipientIds: adminRecipients,
              subject: 'AI 工具调用审批',
              message,
              category: 'ai_tool_approval',
              createdBy: actorId || null,
              metadata: {
                tool: call.type,
                payload: call.payload
              }
            });
            notified.add(key);
            metadataChanged = true;
          }
          continue;
        }
        if (executed.has(key)) {
          continue;
        }
        try {
          const payload = {
            ...(call.payload || {}),
            organizationId
          };
          const context = { actorId: actorId || null };
          await this.toolService.execute(call.type, payload, context);
          executed.add(key);
          metadataChanged = true;
          if (this.metricsService) {
            this.metricsService.incrementCounter(
              'ai_job_tool_executions_total',
              { tool: call.type },
              1,
              { help: 'Number of tool executions triggered from AI parse jobs' }
            );
          }
          if (this.auditService) {
            this.auditService.record({
              actorId: actorId || null,
              action: 'ai.parse_job.tool_execute',
              subjectType: 'ai_parse_job',
              subjectId: job.id,
              organizationId,
              metadata: {
                tool: call.type,
                payloadPreview: truncateValue(call.payload)
              },
              sensitiveFields: ['payloadPreview']
            });
          }
        } catch (error) {
          if (this.metricsService) {
            this.metricsService.incrementCounter(
              'ai_job_tool_executions_total',
              { tool: call.type, status: 'error' },
              1,
              { help: 'Number of tool executions triggered from AI parse jobs' }
            );
          }
          if (!this.metricsService) {
            // no-op
          }
          if (this.auditService) {
            this.auditService.record({
              actorId: actorId || null,
              action: 'ai.parse_job.tool_execute_error',
              subjectType: 'ai_parse_job',
              subjectId: job.id,
              organizationId,
              metadata: {
                tool: call.type,
                error: error && error.message ? error.message : 'execution_failed'
              }
            });
          }
        }
      }
    }
    if (metadataChanged) {
      const metadata = {
        executedToolCalls: Array.from(executed),
        approvalNotifications: Array.from(notified)
      };
      await this.client.updateJob(job.id, { metadata });
      job.metadata = {
        ...job.metadata,
        ...metadata
      };
    }
    return job;
  }

  #recordJobMetrics(job) {
    if (!job || !this.metricsService) {
      return;
    }
    const provider = job.provider || 'unknown';
    const status = job.status || 'UNKNOWN';
    const labels = { provider };
    if (status === JOB_STATUS.succeeded) {
      this.metricsService.incrementCounter(
        'ai_parse_success_total',
        labels,
        1,
        { help: 'Number of AI parse jobs that completed without requiring review grouped by provider' }
      );
    } else if (status === JOB_STATUS.failed) {
      this.metricsService.incrementCounter(
        'ai_parse_failure_total',
        labels,
        1,
        { help: 'Number of AI parse jobs that failed grouped by provider' }
      );
    } else if (status === JOB_STATUS.needsReview) {
      this.metricsService.incrementCounter(
        'ai_parse_needs_review_total',
        labels,
        1,
        { help: 'Number of AI parse jobs that require manual review grouped by provider' }
      );
    }
    const createdAt = Date.parse(job.createdAt);
    const completionTimestamp =
      Date.parse(job.metadata?.completedAt || job.metadata?.failedAt || job.metadata?.reviewedAt || '') || null;
    if (Number.isFinite(createdAt) && completionTimestamp && completionTimestamp >= createdAt) {
      const duration = completionTimestamp - createdAt;
      this.metricsService.observeSummary(
        'ai_parse_duration_ms',
        { provider, status: status.toLowerCase() },
        duration,
        { help: 'AI parse job lifecycle duration in milliseconds grouped by provider and outcome' }
      );
    }
  }
}

function truncateValue(value) {
  if (value == null) {
    return null;
  }
  const stringified = typeof value === 'string' ? value : JSON.stringify(value);
  if (stringified.length <= 64) {
    return stringified;
  }
  return `${stringified.slice(0, 61)}...`;
}

export { AiParseJobService, InMemoryParseJobClient, JOB_STATUS, REVIEW_DECISION };
