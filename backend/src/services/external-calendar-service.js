import { randomUUID } from 'node:crypto';

const SUPPORTED_PROVIDERS = new Set(['GOOGLE', 'MICROSOFT', 'CALDAV', 'GENERIC']);

function assertString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    const error = new Error(`${field} is required`);
    error.code = 'EXTERNAL_CALENDAR_INVALID_ARGUMENT';
    error.field = field;
    throw error;
  }
  return value.trim();
}

function cloneJson(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeProvider(provider) {
  const normalized = assertString(provider, 'provider').toUpperCase();
  if (!SUPPORTED_PROVIDERS.has(normalized)) {
    const error = new Error(`Unsupported provider ${provider}`);
    error.code = 'EXTERNAL_CALENDAR_UNSUPPORTED_PROVIDER';
    error.field = 'provider';
    throw error;
  }
  return normalized;
}

function normalizeScopes(scopes) {
  if (scopes === undefined || scopes === null) {
    return [];
  }
  if (!Array.isArray(scopes)) {
    const error = new Error('scopes must be an array of strings');
    error.code = 'EXTERNAL_CALENDAR_INVALID_ARGUMENT';
    error.field = 'scopes';
    throw error;
  }
  return scopes.map((scope, index) => {
    if (typeof scope !== 'string' || scope.trim() === '') {
      const error = new Error(`Scope at index ${index} must be a non-empty string`);
      error.code = 'EXTERNAL_CALENDAR_INVALID_ARGUMENT';
      error.field = 'scopes';
      throw error;
    }
    return scope.trim();
  });
}

function normalizeCalendars(calendars) {
  if (calendars === undefined || calendars === null) {
    return [];
  }
  if (!Array.isArray(calendars)) {
    const error = new Error('calendars must be an array');
    error.code = 'EXTERNAL_CALENDAR_INVALID_ARGUMENT';
    error.field = 'calendars';
    throw error;
  }
  return calendars.map((calendar, index) => {
    if (!calendar || typeof calendar !== 'object') {
      const error = new Error(`Calendar at index ${index} must be an object`);
      error.code = 'EXTERNAL_CALENDAR_INVALID_ARGUMENT';
      error.field = 'calendars';
      throw error;
    }
    const id = assertString(calendar.id, `calendars[${index}].id`);
    const name = assertString(calendar.name, `calendars[${index}].name`);
    const primary = Boolean(calendar.primary);
    return { id, name, primary };
  });
}

class ExternalCalendarService {
  constructor({
    idGenerator = randomUUID,
    clock = () => new Date(),
    queueService = null,
    metricsService = null,
    auditService = null
  } = {}) {
    this.idGenerator = idGenerator;
    this.clock = clock;
    this.queueService = queueService;
    this.metricsService = metricsService;
    this.auditService = auditService;
    this.connections = new Map();
    this.connectionsByOrg = new Map();
    this.connectionsByUser = new Map();
  }

  #persist(connection) {
    this.connections.set(connection.id, connection);
    if (!this.connectionsByOrg.has(connection.organizationId)) {
      this.connectionsByOrg.set(connection.organizationId, new Set());
    }
    this.connectionsByOrg.get(connection.organizationId).add(connection.id);
    if (!this.connectionsByUser.has(connection.userId)) {
      this.connectionsByUser.set(connection.userId, new Set());
    }
    this.connectionsByUser.get(connection.userId).add(connection.id);
    return connection;
  }

  #unpersist(connection) {
    this.connections.delete(connection.id);
    const orgSet = this.connectionsByOrg.get(connection.organizationId);
    if (orgSet) {
      orgSet.delete(connection.id);
      if (orgSet.size === 0) {
        this.connectionsByOrg.delete(connection.organizationId);
      }
    }
    const userSet = this.connectionsByUser.get(connection.userId);
    if (userSet) {
      userSet.delete(connection.id);
      if (userSet.size === 0) {
        this.connectionsByUser.delete(connection.userId);
      }
    }
  }

  #serialize(connection) {
    return {
      id: connection.id,
      organizationId: connection.organizationId,
      userId: connection.userId,
      provider: connection.provider,
      accountId: connection.accountId,
      displayName: connection.displayName,
      credentialId: connection.credentialId,
      scopes: connection.scopes.slice(),
      metadata: cloneJson(connection.metadata),
      calendars: connection.calendars.map((calendar) => ({ ...calendar })),
      status: connection.status,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
      lastSyncedAt: connection.lastSyncedAt,
      lastSyncStatus: connection.lastSyncStatus,
      syncHistory: connection.syncHistory.map((entry) => ({ ...entry }))
    };
  }

  #ensureUniqueAccount({ organizationId, provider, accountId }) {
    const orgSet = this.connectionsByOrg.get(organizationId);
    if (!orgSet) {
      return;
    }
    for (const connectionId of orgSet.values()) {
      const existing = this.connections.get(connectionId);
      if (existing && existing.provider === provider && existing.accountId === accountId) {
        const error = new Error('Provider account already linked for organization');
        error.code = 'EXTERNAL_CALENDAR_DUPLICATE_ACCOUNT';
        throw error;
      }
    }
  }

  createConnection({
    organizationId,
    userId,
    provider,
    accountId,
    displayName,
    scopes = [],
    credentialId = null,
    metadata = {},
    calendars = [],
    createdBy = null
  } = {}) {
    const orgId = assertString(organizationId, 'organizationId');
    const ownerId = assertString(userId, 'userId');
    const normalizedProvider = normalizeProvider(provider);
    const normalizedAccountId = assertString(accountId, 'accountId');
    const normalizedDisplayName = assertString(displayName, 'displayName');
    const normalizedScopes = normalizeScopes(scopes);
    const normalizedCalendars = normalizeCalendars(calendars);
    if (credentialId !== null && typeof credentialId !== 'string') {
      const error = new Error('credentialId must be a string when provided');
      error.code = 'EXTERNAL_CALENDAR_INVALID_ARGUMENT';
      error.field = 'credentialId';
      throw error;
    }
    if (metadata && typeof metadata !== 'object') {
      const error = new Error('metadata must be an object');
      error.code = 'EXTERNAL_CALENDAR_INVALID_ARGUMENT';
      error.field = 'metadata';
      throw error;
    }
    this.#ensureUniqueAccount({
      organizationId: orgId,
      provider: normalizedProvider,
      accountId: normalizedAccountId
    });
    const now = this.clock().toISOString();
    const connection = {
      id: this.idGenerator(),
      organizationId: orgId,
      userId: ownerId,
      provider: normalizedProvider,
      accountId: normalizedAccountId,
      displayName: normalizedDisplayName,
      credentialId: credentialId || null,
      scopes: normalizedScopes,
      metadata: cloneJson(metadata) || {},
      calendars: normalizedCalendars,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: null,
      lastSyncStatus: null,
      syncHistory: []
    };
    this.#persist(connection);
    if (this.metricsService) {
      this.metricsService.incrementCounter(
        'external_calendar_connections_total',
        { action: 'create', provider: connection.provider },
        1,
        { help: 'Number of external calendar connections grouped by action and provider' }
      );
    }
    if (this.auditService) {
      this.auditService.record({
        actorId: createdBy,
        action: 'externalCalendar.connect',
        subjectType: 'externalCalendarConnection',
        subjectId: connection.id,
        organizationId: connection.organizationId,
        metadata: {
          provider: connection.provider,
          accountId: connection.accountId,
          displayName: connection.displayName,
          scopes: connection.scopes
        },
        sensitiveFields: ['accountId']
      });
    }
    return this.#serialize(connection);
  }

  listConnections({ organizationId, userId = null } = {}) {
    const orgId = assertString(organizationId, 'organizationId');
    const connectionIds = this.connectionsByOrg.get(orgId);
    if (!connectionIds) {
      return [];
    }
    const filterByUser = userId ? String(userId) : null;
    const results = [];
    for (const connectionId of connectionIds.values()) {
      const connection = this.connections.get(connectionId);
      if (!connection) {
        continue;
      }
      if (filterByUser && connection.userId !== filterByUser) {
        continue;
      }
      results.push(this.#serialize(connection));
    }
    results.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return results;
  }

  getConnection(connectionId) {
    const id = assertString(connectionId, 'connectionId');
    const connection = this.connections.get(id);
    if (!connection) {
      return null;
    }
    return this.#serialize(connection);
  }

  removeConnection(connectionId, { actorId = null } = {}) {
    const connection = this.connections.get(assertString(connectionId, 'connectionId'));
    if (!connection) {
      const error = new Error('Connection not found');
      error.code = 'EXTERNAL_CALENDAR_NOT_FOUND';
      throw error;
    }
    this.#unpersist(connection);
    if (this.metricsService) {
      this.metricsService.incrementCounter(
        'external_calendar_connections_total',
        { action: 'delete', provider: connection.provider },
        1,
        { help: 'Number of external calendar connections grouped by action and provider' }
      );
    }
    if (this.auditService) {
      this.auditService.record({
        actorId,
        action: 'externalCalendar.disconnect',
        subjectType: 'externalCalendarConnection',
        subjectId: connection.id,
        organizationId: connection.organizationId,
        metadata: {
          provider: connection.provider,
          accountId: connection.accountId
        },
        sensitiveFields: ['accountId']
      });
    }
    return this.#serialize(connection);
  }

  async triggerSync(connectionId, { actorId = null, reason = 'manual' } = {}) {
    const connection = this.connections.get(assertString(connectionId, 'connectionId'));
    if (!connection) {
      const error = new Error('Connection not found');
      error.code = 'EXTERNAL_CALENDAR_NOT_FOUND';
      throw error;
    }
    if (!this.queueService) {
      const error = new Error('Queue service is not configured');
      error.code = 'EXTERNAL_CALENDAR_QUEUE_UNAVAILABLE';
      throw error;
    }
    const now = this.clock().toISOString();
    let job;
    try {
      job = await this.queueService.enqueueJob({
        organizationId: connection.organizationId,
        type: 'externalCalendar.sync',
        payload: {
          connectionId: connection.id,
          provider: connection.provider,
          accountId: connection.accountId,
          userId: connection.userId,
          reason
        },
        dedupeKey: `external-calendar-sync:${connection.id}`,
        createdBy: actorId
      });
    } catch (error) {
      const err = new Error('Failed to enqueue sync job');
      err.code = 'EXTERNAL_CALENDAR_SYNC_FAILED';
      err.cause = error;
      throw err;
    }
    const syncRecord = {
      id: this.idGenerator(),
      jobId: job.id,
      status: 'QUEUED',
      reason,
      requestedBy: actorId,
      requestedAt: now
    };
    connection.syncHistory.push(syncRecord);
    while (connection.syncHistory.length > 25) {
      connection.syncHistory.shift();
    }
    connection.updatedAt = now;
    connection.lastSyncStatus = 'QUEUED';
    if (this.metricsService) {
      this.metricsService.incrementCounter(
        'external_calendar_sync_requests_total',
        { provider: connection.provider, status: 'queued' },
        1,
        { help: 'Number of external calendar sync requests grouped by provider and outcome' }
      );
    }
    if (this.auditService) {
      this.auditService.record({
        actorId,
        action: 'externalCalendar.sync.request',
        subjectType: 'externalCalendarConnection',
        subjectId: connection.id,
        organizationId: connection.organizationId,
        metadata: {
          provider: connection.provider,
          accountId: connection.accountId,
          jobId: job.id,
          reason
        },
        sensitiveFields: ['accountId']
      });
    }
    return { job, syncRequest: { ...syncRecord }, connection: this.#serialize(connection) };
  }

  recordSyncResult(connectionId, { jobId = null, status, finishedAt = this.clock().toISOString(), details = null } = {}) {
    const connection = this.connections.get(assertString(connectionId, 'connectionId'));
    if (!connection) {
      const error = new Error('Connection not found');
      error.code = 'EXTERNAL_CALENDAR_NOT_FOUND';
      throw error;
    }
    const normalizedStatus = assertString(status, 'status').toUpperCase();
    connection.lastSyncedAt = finishedAt;
    connection.lastSyncStatus = normalizedStatus;
    const history = connection.syncHistory;
    if (jobId) {
      const record = history.find((entry) => entry.jobId === jobId);
      if (record) {
        record.status = normalizedStatus;
        record.completedAt = finishedAt;
        record.details = cloneJson(details);
      }
    }
    if (this.metricsService) {
      this.metricsService.incrementCounter(
        'external_calendar_sync_requests_total',
        { provider: connection.provider, status: normalizedStatus.toLowerCase() },
        1,
        { help: 'Number of external calendar sync requests grouped by provider and outcome' }
      );
      if (normalizedStatus !== 'SUCCESS') {
        this.metricsService.incrementCounter(
          'external_calendar_failures_total',
          { provider: connection.provider, status: normalizedStatus.toLowerCase() },
          1,
          { help: 'Number of external calendar sync failures grouped by provider and status' }
        );
      }
    }
    return this.#serialize(connection);
  }
}

export { ExternalCalendarService };
