import { randomUUID } from 'node:crypto';

function maskValue(value) {
  if (typeof value !== 'string') {
    return value;
  }
  if (value.length <= 2) {
    return '*'.repeat(value.length || 1);
  }
  const prefix = value.slice(0, Math.min(2, value.length - 1));
  const suffix = value.slice(-1);
  return `${prefix}***${suffix}`;
}

function sanitizePayload(payload, sensitiveFields = []) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizePayload(item, sensitiveFields));
  }
  const sanitized = {};
  for (const [key, value] of Object.entries(payload)) {
    if (sensitiveFields.includes(key)) {
      sanitized[key] = maskValue(typeof value === 'string' ? value : String(value));
      continue;
    }
    if (value && typeof value === 'object') {
      sanitized[key] = sanitizePayload(value, sensitiveFields);
      continue;
    }
    if (typeof value === 'string' && /@/.test(value)) {
      sanitized[key] = maskValue(value);
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

class AuditService {
  constructor({ idGenerator = randomUUID, clock = () => new Date(), metricsService = null } = {}) {
    this.idGenerator = idGenerator;
    this.clock = clock;
    this.metricsService = metricsService;
    this.entries = [];
  }

  record({
    actorId = null,
    action,
    subjectType,
    subjectId = null,
    organizationId = null,
    metadata = {},
    sensitiveFields = []
  }) {
    if (!action) {
      throw new Error('action is required');
    }
    if (!subjectType) {
      throw new Error('subjectType is required');
    }
    const entry = {
      id: this.idGenerator(),
      actorId,
      action,
      subjectType,
      subjectId,
      organizationId,
      metadata: sanitizePayload(metadata, sensitiveFields),
      createdAt: this.clock().toISOString()
    };
    this.entries.push(entry);
    if (this.metricsService) {
      this.metricsService.incrementCounter('audit_entries_total', { action }, 1, {
        help: 'Number of audit log entries captured by action'
      });
    }
    return { ...entry, metadata: JSON.parse(JSON.stringify(entry.metadata)) };
  }

  list({ organizationId = null } = {}) {
    if (!organizationId) {
      return this.entries.slice().map((entry) => ({
        ...entry,
        metadata: JSON.parse(JSON.stringify(entry.metadata))
      }));
    }
    return this.entries
      .filter((entry) => entry.organizationId === organizationId)
      .map((entry) => ({ ...entry, metadata: JSON.parse(JSON.stringify(entry.metadata)) }));
  }
}

export { AuditService };
