import http from 'node:http';
import { URL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { OrganizationService } from './services/organization-service.js';
import { EventService } from './services/event-service.js';
import { EventBus } from './services/event-bus.js';
import { AvailabilityService } from './services/availability-service.js';
import { SchedulingService } from './services/scheduling-service.js';
import { NotificationService } from './services/notification-service.js';
import { ToolService } from './services/tool-service.js';
import { MetricsService } from './services/metrics-service.js';
import { AuditService } from './services/audit-service.js';
import { BrandingService } from './services/branding-service.js';
import { RecurrenceService } from './services/recurrence-service.js';
import { QueueService } from './services/queue-service.js';
import { AiParseJobService } from './services/ai-parse-job-service.js';
import { ExternalCalendarService } from './services/external-calendar-service.js';
import { requireAuth, requireRole, injectOrgScope } from './middleware/auth.js';

function createResponder(res, { onFinish } = {}) {
  let statusCode = 200;
  let finished = false;
  const finalize = (code, writer) => {
    if (finished) {
      return;
    }
    statusCode = code;
    writer();
    finished = true;
    if (typeof onFinish === 'function') {
      try {
        onFinish(statusCode);
      } catch (error) {
        // ignore observer errors
      }
    }
  };
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      finalize(statusCode, () => {
        res.statusCode = statusCode;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(payload));
      });
      return this;
    },
    text(payload, contentType = 'text/plain; charset=utf-8') {
      finalize(statusCode, () => {
        res.statusCode = statusCode;
        res.setHeader('Content-Type', contentType);
        res.end(String(payload));
      });
      return this;
    },
    sendStatus(code) {
      finalize(code, () => {
        res.statusCode = code;
        res.end();
      });
      return this;
    },
    get finished() {
      return finished;
    }
  };
}

async function applyMiddlewares(req, res, middlewares) {
  try {
    for (const middleware of middlewares) {
      let nextCalled = false;
      await new Promise((resolve, reject) => {
        const next = (err) => {
          if (nextCalled) {
            return;
          }
          nextCalled = true;
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        };
        try {
          const result = middleware(req, res, next);
          if (result && typeof result.then === 'function') {
            result.then(() => {
              if (!nextCalled) {
                resolve();
              }
            }).catch(reject);
          } else if (!nextCalled) {
            if (res.finished) {
              resolve();
            } else {
              resolve();
            }
          }
        } catch (error) {
          reject(error);
        }
      });
      if (res.finished) {
        return false;
      }
    }
    return !res.finished;
  } catch (error) {
    if (!res.finished) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
    return false;
  }
}

async function readJsonBody(req, res) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    res.status(400).json({ message: 'Invalid JSON body' });
    return undefined;
  }
}

async function hasOrgScope(req, orgId, organizationService) {
  const user = req.session && req.session.user;
  if (!user) {
    return false;
  }
  if (user.globalRole === 'SUPER_ADMIN') {
    return true;
  }
  const scopedOrgIds = Array.isArray(req.orgIds)
    ? req.orgIds
    : Array.isArray(user.orgIds)
      ? user.orgIds
      : [];
  if (scopedOrgIds.includes(orgId)) {
    return true;
  }
  if (user.globalRole === 'ADMIN') {
    return await organizationService.isAdmin(orgId, user.id);
  }
  return false;
}

async function canAdministerOrg(user, orgId, organizationService) {
  if (!user) {
    return false;
  }
  if (user.globalRole === 'SUPER_ADMIN') {
    return true;
  }
  if (user.globalRole === 'ADMIN') {
    return await organizationService.isAdmin(orgId, user.id);
  }
  return false;
}

function mapEventError(responder, error) {
  switch (error.code) {
    case 'EVENT_INVALID_PAYLOAD':
    case 'EVENT_INVALID_RANGE':
    case 'EVENT_INVALID_DATE':
      responder.status(400).json({ message: error.message, code: error.code, field: error.field });
      return true;
    case 'EVENT_NOT_FOUND':
      responder.status(404).json({ message: error.message, code: error.code });
      return true;
    case 'EVENT_VERSION_MISMATCH':
      responder.status(409).json({ message: error.message, code: error.code });
      return true;
    case 'EVENT_CONFLICT':
      responder.status(409).json({ message: error.message, code: error.code, conflicts: error.conflicts });
      return true;
    default:
      return false;
  }
}

function mapAvailabilityError(responder, error) {
  switch (error.code) {
    case 'AVAILABILITY_INVALID_ARGUMENT':
    case 'AVAILABILITY_INVALID_RANGE':
    case 'AVAILABILITY_INVALID_DATE':
    case 'AVAILABILITY_INVALID_BUSY_ENTRY':
      responder.status(400).json({ message: error.message, code: error.code, field: error.field });
      return true;
    default:
      return false;
  }
}

function mapSchedulingError(responder, error) {
  switch (error.code) {
    case 'SCHEDULING_INVALID_ARGUMENT':
    case 'SCHEDULING_INVALID_RANGE':
    case 'SCHEDULING_INVALID_DATE':
      responder.status(400).json({ message: error.message, code: error.code, field: error.field });
      return true;
    case 'SCHEDULING_NOT_FOUND':
      responder.status(404).json({ message: error.message, code: error.code });
      return true;
    case 'SCHEDULING_NOT_READY':
    case 'SCHEDULING_EMPTY_PLAN':
      responder.status(409).json({ message: error.message, code: error.code });
      return true;
    default:
      return false;
  }
}

function mapBrandingError(responder, error) {
  switch (error.code) {
    case 'BRANDING_INVALID_ARGUMENT':
    case 'BRANDING_INVALID_COLOR':
    case 'BRANDING_INVALID_LOGO_URL':
    case 'BRANDING_INVALID_NOTIFICATION_TEMPLATE':
    case 'BRANDING_INVALID_TOKENS':
      responder
        .status(400)
        .json({ message: error.message, code: error.code, field: error.field });
      return true;
    case 'BRANDING_ORG_NOT_FOUND':
    case 'ORG_NOT_FOUND':
      responder.status(404).json({ message: 'Organization not found', code: error.code });
      return true;
    default:
      return false;
  }
}

function mapRecurrenceError(responder, error) {
  switch (error.code) {
    case 'RECURRENCE_INVALID_RULE':
    case 'RECURRENCE_INVALID_EXDATES':
    case 'RECURRENCE_INVALID_INTERVAL':
    case 'RECURRENCE_INVALID_RANGE':
      responder.status(400).json({ message: error.message, code: error.code, field: error.field });
      return true;
    case 'RECURRENCE_UNSUPPORTED_FREQUENCY':
      responder.status(422).json({ message: error.message, code: error.code });
      return true;
    case 'RECURRENCE_EVENT_NOT_FOUND':
    case 'RECURRENCE_NOT_FOUND':
      responder.status(404).json({ message: error.message, code: error.code });
      return true;
    case 'RECURRENCE_INVALID_EVENT':
      responder.status(409).json({ message: error.message, code: error.code });
      return true;
    default:
      return false;
  }
}

function mapToolError(responder, error) {
  switch (error.code) {
    case 'TOOL_INVALID_ARGUMENT':
    case 'TOOL_MISSING_ACTOR':
    case 'TOOL_UNSUPPORTED':
      responder.status(400).json({ message: error.message, code: error.code, field: error.field });
      return true;
    case 'TOOL_ORG_NOT_FOUND':
      responder.status(404).json({ message: error.message, code: error.code });
      return true;
    default:
      return false;
  }
}

function mapQueueError(responder, error) {
  switch (error.code) {
    case 'QUEUE_INVALID_ARGUMENT':
      responder.status(400).json({ message: error.message, code: error.code, field: error.field });
      return true;
    case 'QUEUE_NOT_FOUND':
      responder.status(404).json({ message: error.message, code: error.code });
      return true;
    case 'QUEUE_INVALID_STATE':
      responder.status(409).json({ message: error.message, code: error.code });
      return true;
    default:
      return false;
  }
}

function mapExternalCalendarError(responder, error) {
  switch (error.code) {
    case 'EXTERNAL_CALENDAR_INVALID_ARGUMENT':
    case 'EXTERNAL_CALENDAR_UNSUPPORTED_PROVIDER':
      responder.status(400).json({ message: error.message, code: error.code, field: error.field });
      return true;
    case 'EXTERNAL_CALENDAR_DUPLICATE_ACCOUNT':
      responder.status(409).json({ message: error.message, code: error.code });
      return true;
    case 'EXTERNAL_CALENDAR_NOT_FOUND':
      responder.status(404).json({ message: error.message, code: error.code });
      return true;
    case 'EXTERNAL_CALENDAR_QUEUE_UNAVAILABLE':
      responder.status(503).json({ message: error.message, code: error.code });
      return true;
    case 'EXTERNAL_CALENDAR_SYNC_FAILED':
      responder.status(502).json({ message: error.message, code: error.code });
      return true;
    default:
      return false;
  }
}

function sanitizeNotificationForRecipient(notification) {
  const {
    id,
    organizationId,
    subject,
    message,
    category,
    metadata,
    createdBy,
    createdAt,
    readAt
  } = notification;
  return {
    id,
    organizationId,
    subject,
    message,
    category,
    metadata,
    createdBy,
    createdAt,
    readAt
  };
}

function createApp({
  port = 3000,
  services = {},
  sessionParser
} = {}) {
  const metricsService = services.metricsService || new MetricsService();
  const auditService = services.auditService || new AuditService({ metricsService });
  const eventBus = services.eventBus || new EventBus();
  const organizationService = services.organizationService || new OrganizationService();
  const eventService = services.eventService || new EventService({ eventBus, metricsService });
  const availabilityService =
    services.availabilityService || new AvailabilityService({ eventService });
  const queueService =
    services.queueService || new QueueService({ metricsService, auditService });
  const schedulingService =
    services.schedulingService ||
    new SchedulingService({
      availabilityService,
      eventService,
      queueService,
      metricsService
    });
  const recurrenceService =
    services.recurrenceService || new RecurrenceService({ eventService });
  const notificationService =
    services.notificationService || new NotificationService();
  const toolService =
    services.toolService ||
    new ToolService({
      organizationService,
      eventService,
      notificationService,
      auditService,
      metricsService
    });
  const aiParseJobService =
    services.aiParseJobService ||
    new AiParseJobService({
      toolService,
      organizationService,
      metricsService,
      auditService,
      notificationService
    });
  const brandingService =
    services.brandingService || new BrandingService({ organizationService });
  const externalCalendarService =
    services.externalCalendarService ||
    new ExternalCalendarService({ queueService, metricsService, auditService });

  let activeRealtimeConnections = 0;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let routeLabel = `${req.method} ${url.pathname}`;
    const stopTimer = metricsService.startTimer();
    const responder = createResponder(res, {
      onFinish: (statusCode) => {
        const durationMs = stopTimer();
        metricsService.recordHttpRequest({
          method: req.method,
          path: routeLabel,
          statusCode,
          durationMs
        });
      }
    });

    if (typeof sessionParser === 'function') {
      req.session = await sessionParser(req);
    }
    if (!req.session) {
      req.session = {};
    }

    if (req.method === 'GET' && url.pathname === '/healthz') {
      routeLabel = 'GET /healthz';
      responder.status(200).json({ status: 'ok' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/metrics') {
      routeLabel = 'GET /metrics';
      const body = metricsService.toPrometheus();
      responder.status(200).text(body, 'text/plain; version=0.0.4');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/events/stream') {
      routeLabel = 'GET /api/events/stream';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const organizationId = url.searchParams.get('organizationId');
      if (!organizationId) {
        responder.status(400).json({ message: 'organizationId is required' });
        return;
      }
      if (!(await hasOrgScope(req, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }

      const parseSequence = (value) => {
        if (value === undefined || value === null || value === '') {
          return undefined;
        }
        const parsed = Number.parseInt(value, 10);
        if (Number.isNaN(parsed) || parsed < 0) {
          return NaN;
        }
        return parsed;
      };
      const candidateSequenceValues = [
        req.headers['last-event-id'],
        url.searchParams.get('lastEventId'),
        url.searchParams.get('since')
      ];
      let sinceSequence = 0;
      for (const candidate of candidateSequenceValues) {
        const parsed = parseSequence(candidate);
        if (parsed === undefined) {
          continue;
        }
        if (Number.isNaN(parsed)) {
          responder.status(400).json({ message: 'Invalid last event id' });
          return;
        }
        sinceSequence = parsed;
        break;
      }

      const channel = `org:${organizationId}`;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }
      const labels = { channel: 'org' };
      metricsService.incrementCounter(
        'realtime_connections_total',
        { ...labels, status: 'open' },
        1,
        { help: 'Number of realtime stream connections grouped by channel and lifecycle state' }
      );
      activeRealtimeConnections += 1;
      metricsService.setGauge(
        'session_concurrency_gauge',
        { channel: 'sse' },
        activeRealtimeConnections,
        { help: 'Number of concurrent authenticated sessions inferred from active realtime connections' }
      );
      res.write('retry: 5000\n\n');
      res.write(':connected\n\n');

      const sendEnvelope = (envelope) => {
        try {
          const payload = JSON.stringify({
            sequence: envelope.sequence,
            type: envelope.type,
            payload: envelope.payload,
            metadata: envelope.metadata,
            timestamp: envelope.timestamp
          });
          res.write(`id: ${envelope.sequence}\n`);
          res.write(`event: ${envelope.type}\n`);
          res.write(`data: ${payload}\n\n`);
          metricsService.incrementCounter(
            'realtime_messages_total',
            { ...labels, event: envelope.type },
            1,
            { help: 'Number of realtime messages delivered grouped by channel and event type' }
          );
          const latency = Date.now() - Date.parse(envelope.timestamp || '');
          if (Number.isFinite(latency)) {
            metricsService.observeSummary(
              'socket_broadcast_latency_ms',
              { channel: labels.channel, event: envelope.type },
              latency,
              { help: 'Latency between event emission and SSE delivery in milliseconds' }
            );
          }
        } catch (error) {
          // ignore write errors caused by closed connections
        }
      };

      const history = eventBus.historySince(channel, sinceSequence);
      if (history.length > 0) {
        metricsService.incrementCounter(
          'realtime_history_replayed_total',
          { ...labels, status: 'delivered' },
          history.length,
          { help: 'Number of historical realtime messages replayed grouped by channel' }
        );
        for (const envelope of history) {
          sendEnvelope(envelope);
        }
      } else {
        metricsService.incrementCounter(
          'realtime_history_replayed_total',
          { ...labels, status: 'empty' },
          1,
          { help: 'Number of historical realtime messages replayed grouped by channel' }
        );
      }

      const unsubscribe = eventBus.subscribe(channel, sendEnvelope);
      const heartbeatInterval = setInterval(() => {
        try {
          res.write(':heartbeat\n\n');
        } catch (error) {
          // ignore heartbeat write errors
        }
      }, 15000);

      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) {
          return;
        }
        cleanedUp = true;
        clearInterval(heartbeatInterval);
        unsubscribe();
        try {
          res.end();
        } catch (error) {
          // ignore end errors
        }
        metricsService.incrementCounter(
          'realtime_connections_total',
          { ...labels, status: 'closed' },
          1,
          { help: 'Number of realtime stream connections grouped by channel and lifecycle state' }
        );
        activeRealtimeConnections = Math.max(0, activeRealtimeConnections - 1);
        metricsService.setGauge(
          'session_concurrency_gauge',
          { channel: 'sse' },
          activeRealtimeConnections,
          { help: 'Number of concurrent authenticated sessions inferred from active realtime connections' }
        );
        metricsService.recordHttpRequest({
          method: req.method,
          path: routeLabel,
          statusCode: 200,
          durationMs: stopTimer()
        });
      };

      req.on('close', cleanup);
      req.on('aborted', cleanup);
      res.on('close', cleanup);
      res.on('error', cleanup);
      return;
    }

    if (url.pathname === '/api/organizations' && req.method === 'POST') {
      routeLabel = 'POST /api/organizations';
      const proceed = await applyMiddlewares(req, responder, [
        requireAuth,
        injectOrgScope(),
        requireRole('SUPER_ADMIN')
      ]);
      if (!proceed) {
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      const { name, slug, initialAdminIds = [] } = body;
      if (!name || !slug) {
        responder.status(400).json({ message: 'name and slug are required' });
        return;
      }
      try {
        const organization = await organizationService.createOrganization({ name, slug });
        const assignedAdminIds = [];
        for (const adminId of Array.isArray(initialAdminIds) ? initialAdminIds : []) {
          await organizationService.addAdmin(organization.id, adminId);
          assignedAdminIds.push(adminId);
        }
        metricsService.incrementCounter('organizations_created_total', {}, 1, {
          help: 'Number of organizations created'
        });
        auditService.record({
          actorId: req.session.user && req.session.user.id,
          action: 'organization.create',
          subjectType: 'organization',
          subjectId: organization.id,
          organizationId: organization.id,
          metadata: { name, slug },
          sensitiveFields: ['name']
        });
        responder
          .status(201)
          .json({ organization, assignedAdminIds });
      } catch (error) {
        if (error.code === 'ORG_DUPLICATE_SLUG') {
          responder.status(409).json({ message: 'Organization slug already exists' });
          return;
        }
        responder.status(500).json({ message: 'Failed to create organization' });
      }
      return;
    }

    if (url.pathname === '/api/availability/windows' && req.method === 'GET') {
      routeLabel = 'GET /api/availability/windows';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const organizationId = url.searchParams.get('organizationId');
      const rangeStart = url.searchParams.get('start');
      const rangeEnd = url.searchParams.get('end');
      const slotParam = url.searchParams.get('slotMinutes');
      const rawUserIds = [
        ...url.searchParams.getAll('userIds'),
        ...url.searchParams.getAll('userIds[]')
      ];
      if (rawUserIds.length === 0) {
        const single = url.searchParams.get('userIds');
        if (single) {
          rawUserIds.push(...single.split(',').map((value) => value.trim()).filter(Boolean));
        }
      }
      if (!organizationId || !rangeStart || !rangeEnd) {
        responder.status(400).json({ message: 'organizationId, start, and end are required' });
        return;
      }
      if (!(await hasOrgScope(req, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      let slotMinutes;
      if (slotParam !== null) {
        slotMinutes = Number.parseInt(slotParam, 10);
        if (Number.isNaN(slotMinutes)) {
          responder.status(400).json({ message: 'slotMinutes must be a number' });
          return;
        }
      }
      try {
        const result = await availabilityService.getAvailabilityWindows({
          organizationId,
          userIds: rawUserIds,
          rangeStart,
          rangeEnd,
          ...(slotMinutes ? { slotMinutes } : {})
        });
        metricsService.incrementCounter(
          'availability_queries_total',
          { status: 'success' },
          1,
          { help: 'Number of availability window queries grouped by status' }
        );
        responder.status(200).json(result);
      } catch (error) {
        metricsService.incrementCounter(
          'availability_queries_total',
          { status: 'error' },
          1,
          { help: 'Number of availability window queries grouped by status' }
        );
        if (!mapAvailabilityError(responder, error)) {
          responder.status(500).json({ message: 'Failed to calculate availability' });
        }
      }
      return;
    }

    if (url.pathname === '/api/availability/cache' && req.method === 'PUT') {
      routeLabel = 'PUT /api/availability/cache';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      const { organizationId, userId, rangeStart, rangeEnd, busy, source } = body;
      if (!organizationId || !userId || !rangeStart || !rangeEnd) {
        responder.status(400).json({ message: 'organizationId, userId, rangeStart, and rangeEnd are required' });
        return;
      }
      if (!(await hasOrgScope(req, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      if (!(await canAdministerOrg(req.session.user, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Administrator role required to update cache' });
        return;
      }
      try {
        const record = await availabilityService.updateCache({
          organizationId,
          userId,
          rangeStart,
          rangeEnd,
          busy,
          source
        });
        metricsService.incrementCounter(
          'availability_cache_updates_total',
          { status: 'success' },
          1,
          { help: 'Number of availability cache upserts grouped by status' }
        );
        auditService.record({
          actorId: req.session.user && req.session.user.id,
          action: 'availability.cache.update',
          subjectType: 'availabilityCache',
          subjectId: `${organizationId}:${userId}`,
          organizationId,
          metadata: {
            userId,
            rangeStart: record.rangeStart,
            rangeEnd: record.rangeEnd,
            source: record.source,
            busyCount: Array.isArray(record.busy) ? record.busy.length : 0
          }
        });
        responder.status(200).json({ record });
      } catch (error) {
        metricsService.incrementCounter(
          'availability_cache_updates_total',
          { status: 'error' },
          1,
          { help: 'Number of availability cache upserts grouped by status' }
        );
        if (!mapAvailabilityError(responder, error)) {
          responder.status(500).json({ message: 'Failed to update availability cache' });
        }
      }
      return;
    }

    if (url.pathname === '/api/availability/cache' && req.method === 'GET') {
      routeLabel = 'GET /api/availability/cache';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const organizationId = url.searchParams.get('organizationId');
      if (!organizationId) {
        responder.status(400).json({ message: 'organizationId is required' });
        return;
      }
      if (!(await hasOrgScope(req, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      const userIds = [
        ...url.searchParams.getAll('userId'),
        ...url.searchParams.getAll('userIds'),
        ...url.searchParams.getAll('userIds[]')
      ];
      if (userIds.length === 0) {
        const csv = url.searchParams.get('userIds');
        if (csv) {
          userIds.push(
            ...csv
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
          );
        }
      }
      try {
        const records = await availabilityService.listCacheRecords({ organizationId, userIds });
        metricsService.incrementCounter(
          'availability_cache_queries_total',
          { status: 'success' },
          1,
          { help: 'Number of availability cache lookups grouped by status' }
        );
        responder.status(200).json({ records });
      } catch (error) {
        metricsService.incrementCounter(
          'availability_cache_queries_total',
          { status: 'error' },
          1,
          { help: 'Number of availability cache lookups grouped by status' }
        );
        if (!mapAvailabilityError(responder, error)) {
          responder.status(500).json({ message: 'Failed to load availability cache' });
        }
      }
      return;
    }

    if (url.pathname === '/api/availability/cache' && req.method === 'DELETE') {
      routeLabel = 'DELETE /api/availability/cache';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      const { organizationId, userId } = body;
      if (!organizationId || !userId) {
        responder.status(400).json({ message: 'organizationId and userId are required' });
        return;
      }
      if (!(await hasOrgScope(req, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      if (!(await canAdministerOrg(req.session.user, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Administrator role required to clear cache' });
        return;
      }
      try {
        const removed = await availabilityService.clearCache({ organizationId, userId });
        metricsService.incrementCounter(
          'availability_cache_deletes_total',
          { status: removed ? 'success' : 'noop' },
          1,
          { help: 'Number of availability cache clears grouped by outcome' }
        );
        if (removed) {
          auditService.record({
            actorId: req.session.user && req.session.user.id,
            action: 'availability.cache.delete',
            subjectType: 'availabilityCache',
            subjectId: `${organizationId}:${userId}`,
            organizationId,
            metadata: { userId }
          });
        }
        responder.status(204).sendStatus(204);
      } catch (error) {
        metricsService.incrementCounter(
          'availability_cache_deletes_total',
          { status: 'error' },
          1,
          { help: 'Number of availability cache clears grouped by outcome' }
        );
        if (!mapAvailabilityError(responder, error)) {
          responder.status(500).json({ message: 'Failed to clear availability cache' });
        }
      }
      return;
    }

    if (url.pathname === '/api/external-calendars' && req.method === 'GET') {
      routeLabel = 'GET /api/external-calendars';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const organizationId = url.searchParams.get('organizationId');
      if (!organizationId) {
        responder.status(400).json({ message: 'organizationId is required' });
        return;
      }
      if (!(await hasOrgScope(req, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      const userId = url.searchParams.get('userId');
      try {
        const connections = externalCalendarService.listConnections({
          organizationId,
          ...(userId ? { userId } : {})
        });
        responder.status(200).json({ connections });
      } catch (error) {
        if (!mapExternalCalendarError(responder, error)) {
          responder.status(500).json({ message: 'Failed to list external calendars' });
        }
      }
      return;
    }

    if (url.pathname === '/api/external-calendars' && req.method === 'POST') {
      routeLabel = 'POST /api/external-calendars';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      const {
        organizationId,
        userId,
        provider,
        accountId,
        displayName,
        scopes,
        credentialId,
        metadata,
        calendars
      } = body || {};
      if (!organizationId || !userId || !provider || !accountId || !displayName) {
        responder
          .status(400)
          .json({ message: 'organizationId, userId, provider, accountId, and displayName are required' });
        return;
      }
      const organization = await organizationService.getOrganization(organizationId);
      if (!organization) {
        responder.status(404).json({ message: 'Organization not found' });
        return;
      }
      if (!(await canAdministerOrg(req.session.user, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Administrator role required for organization' });
        return;
      }
      try {
        const connection = externalCalendarService.createConnection({
          organizationId,
          userId,
          provider,
          accountId,
          displayName,
          scopes,
          credentialId,
          metadata,
          calendars,
          createdBy: req.session.user && req.session.user.id
        });
        responder.status(201).json({ connection });
      } catch (error) {
        if (!mapExternalCalendarError(responder, error)) {
          responder.status(500).json({ message: 'Failed to create external calendar connection' });
        }
      }
      return;
    }

    if (url.pathname === '/api/events' && req.method === 'GET') {
      routeLabel = 'GET /api/events';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const organizationId = url.searchParams.get('organizationId');
      const start = url.searchParams.get('start');
      const end = url.searchParams.get('end');
      if (!organizationId) {
        responder.status(400).json({ message: 'organizationId is required' });
        return;
      }
      if (!(await hasOrgScope(req, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      try {
        const events = await eventService.listEvents({ organizationId, start, end });
        responder.status(200).json({ events });
      } catch (error) {
        if (!mapEventError(responder, error)) {
          responder.status(500).json({ message: 'Failed to list events' });
        }
      }
      return;
    }

    if (url.pathname === '/api/events' && req.method === 'POST') {
      routeLabel = 'POST /api/events';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      const {
        organizationId,
        title,
        start,
        end,
        allDay,
        color,
        description,
        assigneeIds
      } = body;
      if (!organizationId) {
        responder.status(400).json({ message: 'organizationId is required' });
        return;
      }
      const organization = await organizationService.getOrganization(organizationId);
      if (!organization) {
        responder.status(404).json({ message: 'Organization not found' });
        return;
      }
      const user = req.session.user;
      if (!(await canAdministerOrg(user, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      try {
        const event = await eventService.createEvent({
          organizationId,
          title,
          start,
          end,
          allDay,
          color,
          description,
          assigneeIds,
          createdBy: user && user.id
        });
        metricsService.incrementCounter(
          'event_changes_total',
          { action: 'create' },
          1,
          { help: 'Number of event create/update/delete operations grouped by action' }
        );
        auditService.record({
          actorId: user && user.id,
          action: 'event.create',
          subjectType: 'event',
          subjectId: event.id,
          organizationId,
          metadata: {
            title,
            start,
            end,
            assigneeCount: Array.isArray(assigneeIds) ? assigneeIds.length : 0
          },
          sensitiveFields: ['title']
        });
        responder.status(201).json({ event });
      } catch (error) {
        if (!mapEventError(responder, error)) {
          responder.status(500).json({ message: 'Failed to create event' });
        }
      }
      return;
    }

    if (url.pathname === '/api/organizations' && req.method === 'GET') {
      routeLabel = 'GET /api/organizations';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const mine = url.searchParams.get('mine');
      const user = req.session.user;
      let organizations;
      if (mine === 'true') {
        organizations = await organizationService.listOrganizationsForUser(user);
      } else if (user && user.globalRole === 'SUPER_ADMIN') {
        organizations = await organizationService.listOrganizations();
      } else {
        organizations = await organizationService.listOrganizationsForUser(user);
      }
      responder.status(200).json({ organizations });
      return;
    }

    let match = url.pathname.match(/^\/api\/organizations\/([^/]+)\/admins$/);
    if (match && req.method === 'POST') {
      routeLabel = 'POST /api/organizations/:id/admins';
      const orgId = match[1];
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const user = req.session.user;
      if (!(await canAdministerOrg(user, orgId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      const { userId } = body;
      if (!userId) {
        responder.status(400).json({ message: 'userId is required' });
        return;
      }
      try {
        const assignment = await organizationService.addAdmin(orgId, userId);
        metricsService.incrementCounter(
          'organization_admin_assignments_total',
          { action: 'add' },
          1,
          { help: 'Number of administrator assignment operations' }
        );
        auditService.record({
          actorId: user && user.id,
          action: 'organization.admin.add',
          subjectType: 'organizationAdmin',
          subjectId: `${orgId}:${userId}`,
          organizationId: orgId,
          metadata: { userId }
        });
        responder.status(200).json({ assignment });
      } catch (error) {
        if (error.code === 'ORG_NOT_FOUND') {
          responder.status(404).json({ message: 'Organization not found' });
          return;
        }
        responder.status(500).json({ message: 'Failed to add admin' });
      }
      return;
    }

    match = url.pathname.match(/^\/api\/organizations\/([^/]+)\/groups$/);
    if (match && req.method === 'POST') {
      routeLabel = 'POST /api/organizations/:id/groups';
      const orgId = match[1];
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const user = req.session.user;
      if (!(await canAdministerOrg(user, orgId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      const { name } = body;
      if (!name) {
        responder.status(400).json({ message: 'name is required' });
        return;
      }
      try {
        const group = await organizationService.addGroup(orgId, { name });
        metricsService.incrementCounter(
          'organization_groups_created_total',
          {},
          1,
          { help: 'Number of groups created across organizations' }
        );
        auditService.record({
          actorId: user && user.id,
          action: 'organization.group.create',
          subjectType: 'group',
          subjectId: group.id,
          organizationId: orgId,
          metadata: { name },
          sensitiveFields: ['name']
        });
        responder.status(201).json({ group });
      } catch (error) {
        if (error.code === 'ORG_NOT_FOUND') {
          responder.status(404).json({ message: 'Organization not found' });
          return;
        }
        if (error.code === 'GROUP_DUPLICATE_NAME') {
          responder.status(409).json({ message: 'Group name already exists' });
          return;
        }
        responder.status(500).json({ message: 'Failed to create group' });
      }
      return;
    }

    match = url.pathname.match(/^\/api\/external-calendars\/([^/]+)$/);
    if (match && req.method === 'GET') {
      routeLabel = 'GET /api/external-calendars/:id';
      const connectionId = match[1];
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const connection = externalCalendarService.getConnection(connectionId);
      if (!connection) {
        responder.status(404).json({ message: 'Connection not found' });
        return;
      }
      if (!(await hasOrgScope(req, connection.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      responder.status(200).json({ connection });
      return;
    }

    if (match && req.method === 'DELETE') {
      routeLabel = 'DELETE /api/external-calendars/:id';
      const connectionId = match[1];
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const connection = externalCalendarService.getConnection(connectionId);
      if (!connection) {
        responder.status(404).json({ message: 'Connection not found' });
        return;
      }
      if (!(await canAdministerOrg(req.session.user, connection.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Administrator role required for organization' });
        return;
      }
      try {
        externalCalendarService.removeConnection(connectionId, {
          actorId: req.session.user && req.session.user.id
        });
        responder.status(204).sendStatus(204);
      } catch (error) {
        if (!mapExternalCalendarError(responder, error)) {
          responder.status(500).json({ message: 'Failed to delete external calendar connection' });
        }
      }
      return;
    }

    match = url.pathname.match(/^\/api\/external-calendars\/([^/]+)\/sync$/);
    if (match && req.method === 'POST') {
      routeLabel = 'POST /api/external-calendars/:id/sync';
      const connectionId = match[1];
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const connection = externalCalendarService.getConnection(connectionId);
      if (!connection) {
        responder.status(404).json({ message: 'Connection not found' });
        return;
      }
      if (!(await canAdministerOrg(req.session.user, connection.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Administrator role required for organization' });
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      const { reason } = body || {};
      try {
        const result = await externalCalendarService.triggerSync(connectionId, {
          actorId: req.session.user && req.session.user.id,
          ...(reason ? { reason } : {})
        });
        responder.status(202).json({ job: result.job, syncRequest: result.syncRequest });
      } catch (error) {
        if (!mapExternalCalendarError(responder, error)) {
          responder.status(500).json({ message: 'Failed to enqueue external calendar sync' });
        }
      }
      return;
    }

    match = url.pathname.match(/^\/api\/external-calendars\/([^/]+)\/calendars$/);
    if (match && req.method === 'GET') {
      routeLabel = 'GET /api/external-calendars/:id/calendars';
      const connectionId = match[1];
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const connection = externalCalendarService.getConnection(connectionId);
      if (!connection) {
        responder.status(404).json({ message: 'Connection not found' });
        return;
      }
      if (!(await hasOrgScope(req, connection.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      responder.status(200).json({ calendars: connection.calendars });
      return;
    }

    match = url.pathname.match(/^\/api\/organizations\/([^/]+)\/branding$/);
    if (match && req.method === 'GET') {
      routeLabel = 'GET /api/organizations/:id/branding';
      const orgId = match[1];
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      if (!(await hasOrgScope(req, orgId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      try {
        const branding = await brandingService.getBranding(orgId);
        if (!branding) {
          responder.status(404).json({ message: 'Organization not found' });
          return;
        }
        responder.status(200).json({ branding });
      } catch (error) {
        if (!mapBrandingError(responder, error)) {
          responder.status(500).json({ message: 'Failed to load branding' });
        }
      }
      return;
    }

    match = url.pathname.match(/^\/api\/organizations\/([^/]+)\/branding$/);
    if (match && req.method === 'PUT') {
      routeLabel = 'PUT /api/organizations/:id/branding';
      const orgId = match[1];
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const user = req.session.user;
      if (!(await canAdministerOrg(user, orgId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      try {
        const branding = await brandingService.updateBranding(orgId, body, { updatedBy: user && user.id });
        metricsService.incrementCounter(
          'organization_branding_updates_total',
          { status: 'success' },
          1,
          { help: 'Number of branding updates grouped by status' }
        );
        auditService.record({
          actorId: user && user.id,
          action: 'organization.branding.update',
          subjectType: 'branding',
          subjectId: orgId,
          organizationId: orgId,
          metadata: {
            logoConfigured: Boolean(branding.logoUrl),
            primaryColor: branding.primaryColor,
            secondaryColor: branding.secondaryColor,
            accentColor: branding.accentColor,
            tokenCount: Object.keys(branding.tokens || {}).length
          },
          sensitiveFields: ['notificationTemplates', 'tokens']
        });
        responder.status(200).json({ branding });
      } catch (error) {
        metricsService.incrementCounter(
          'organization_branding_updates_total',
          { status: 'error' },
          1,
          { help: 'Number of branding updates grouped by status' }
        );
        if (!mapBrandingError(responder, error)) {
          responder.status(500).json({ message: 'Failed to update branding' });
        }
      }
      return;
    }

    match = url.pathname.match(/^\/api\/events\/([^/]+)$/);
    if (match && req.method === 'PATCH') {
      routeLabel = 'PATCH /api/events/:id';
      const eventId = match[1];
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const existing = await eventService.getEvent(eventId);
      if (!existing) {
        responder.status(404).json({ message: 'Event not found' });
        return;
      }
      if (!(await hasOrgScope(req, existing.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      const user = req.session.user;
      if (!(await canAdministerOrg(user, existing.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      const {
        title,
        start,
        end,
        allDay,
        color,
        description,
        assigneeIds,
        version
      } = body;
      try {
        const updated = await eventService.updateEvent(eventId, {
          title,
          start,
          end,
          allDay,
          color,
          description,
          assigneeIds,
          expectedVersion: version,
          updatedBy: user && user.id
        });
        metricsService.incrementCounter(
          'event_changes_total',
          { action: 'update' },
          1,
          { help: 'Number of event create/update/delete operations grouped by action' }
        );
        auditService.record({
          actorId: user && user.id,
          action: 'event.update',
          subjectType: 'event',
          subjectId: updated.id,
          organizationId: updated.organizationId,
          metadata: {
            title: updated.title,
            start: updated.start,
            end: updated.end,
            version: updated.version
          },
          sensitiveFields: ['title']
        });
        responder.status(200).json({ event: updated });
      } catch (error) {
        if (!mapEventError(responder, error)) {
          responder.status(500).json({ message: 'Failed to update event' });
        }
      }
      return;
    }

    if (match && req.method === 'DELETE') {
      routeLabel = 'DELETE /api/events/:id';
      const eventId = match[1];
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const existing = await eventService.getEvent(eventId);
      if (!existing) {
        responder.status(404).json({ message: 'Event not found' });
        return;
      }
      if (!(await hasOrgScope(req, existing.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      const user = req.session.user;
      if (!(await canAdministerOrg(user, existing.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      const versionParam = url.searchParams.get('version');
      let expectedVersion;
      if (versionParam !== null) {
        expectedVersion = Number.parseInt(versionParam, 10);
        if (Number.isNaN(expectedVersion)) {
          responder.status(400).json({ message: 'version must be a number' });
          return;
        }
      }
      try {
        const deleted = await eventService.deleteEvent(eventId, { expectedVersion });
        recurrenceService.removeRecurrence(eventId);
        metricsService.incrementCounter(
          'event_changes_total',
          { action: 'delete' },
          1,
          { help: 'Number of event create/update/delete operations grouped by action' }
        );
        auditService.record({
          actorId: user && user.id,
          action: 'event.delete',
          subjectType: 'event',
          subjectId: deleted.id,
          organizationId: deleted.organizationId,
          metadata: { version: deleted.version }
        });
        responder.status(204).sendStatus(204);
      } catch (error) {
        if (!mapEventError(responder, error)) {
          responder.status(500).json({ message: 'Failed to delete event' });
        }
      }
      return;
    }

    match = url.pathname.match(/^\/api\/events\/([^/]+)\/recurrence$/);
    if (match && req.method === 'GET') {
      routeLabel = 'GET /api/events/:id/recurrence';
      const eventId = match[1];
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const event = await eventService.getEvent(eventId);
      if (!event) {
        responder.status(404).json({ message: 'Event not found' });
        return;
      }
      if (!(await hasOrgScope(req, event.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      const start = url.searchParams.get('start');
      const end = url.searchParams.get('end');
      if ((start && !end) || (!start && end)) {
        responder.status(400).json({ message: 'start and end must be provided together' });
        return;
      }
      try {
        const recurrence = recurrenceService.getRecurrence(eventId);
        if (!recurrence) {
          responder.status(404).json({ message: 'Recurrence not found' });
          return;
        }
        let occurrences;
        if (start && end) {
          const expansion = await recurrenceService.expandOccurrences(eventId, {
            rangeStart: start,
            rangeEnd: end
          });
          occurrences = expansion;
        }
        metricsService.incrementCounter(
          'event_recurrence_queries_total',
          { status: 'success' },
          1,
          { help: 'Number of recurrence queries grouped by status' }
        );
        responder.status(200).json({ recurrence, ...(occurrences ? { occurrences } : {}) });
      } catch (error) {
        metricsService.incrementCounter(
          'event_recurrence_queries_total',
          { status: 'error' },
          1,
          { help: 'Number of recurrence queries grouped by status' }
        );
        if (!mapRecurrenceError(responder, error)) {
          responder.status(500).json({ message: 'Failed to load recurrence' });
        }
      }
      return;
    }

    if (match && req.method === 'PUT') {
      routeLabel = 'PUT /api/events/:id/recurrence';
      const eventId = match[1];
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const event = await eventService.getEvent(eventId);
      if (!event) {
        responder.status(404).json({ message: 'Event not found' });
        return;
      }
      if (!(await hasOrgScope(req, event.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      const user = req.session.user;
      if (!(await canAdministerOrg(user, event.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      try {
        const recurrence = await recurrenceService.setRecurrence(eventId, body, { actorId: user && user.id });
        metricsService.incrementCounter(
          'event_recurrence_changes_total',
          { action: 'upsert', status: 'success' },
          1,
          { help: 'Number of recurrence create/update/delete operations grouped by action and status' }
        );
        auditService.record({
          actorId: user && user.id,
          action: 'event.recurrence.upsert',
          subjectType: 'event',
          subjectId: eventId,
          organizationId: event.organizationId,
          metadata: {
            interval: recurrence.interval,
            exdatesCount: recurrence.exdates.length,
            rrule: recurrence.rrule
          },
          sensitiveFields: ['rrule', 'exdates']
        });
        responder.status(200).json({ recurrence });
      } catch (error) {
        metricsService.incrementCounter(
          'event_recurrence_changes_total',
          { action: 'upsert', status: 'error' },
          1,
          { help: 'Number of recurrence create/update/delete operations grouped by action and status' }
        );
        if (!mapRecurrenceError(responder, error)) {
          responder.status(500).json({ message: 'Failed to update recurrence' });
        }
      }
      return;
    }

    if (match && req.method === 'DELETE') {
      routeLabel = 'DELETE /api/events/:id/recurrence';
      const eventId = match[1];
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const event = await eventService.getEvent(eventId);
      if (!event) {
        responder.status(404).json({ message: 'Event not found' });
        return;
      }
      if (!(await hasOrgScope(req, event.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      const user = req.session.user;
      if (!(await canAdministerOrg(user, event.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      try {
        const removed = recurrenceService.removeRecurrence(eventId);
        if (!removed) {
          responder.status(404).json({ message: 'Recurrence not found' });
          return;
        }
        metricsService.incrementCounter(
          'event_recurrence_changes_total',
          { action: 'delete', status: 'success' },
          1,
          { help: 'Number of recurrence create/update/delete operations grouped by action and status' }
        );
        auditService.record({
          actorId: user && user.id,
          action: 'event.recurrence.delete',
          subjectType: 'event',
          subjectId: eventId,
          organizationId: event.organizationId,
          metadata: { rrule: removed.rrule, exdatesCount: removed.exdates.length },
          sensitiveFields: ['rrule', 'exdates']
        });
        responder.status(204).sendStatus(204);
      } catch (error) {
        metricsService.incrementCounter(
          'event_recurrence_changes_total',
          { action: 'delete', status: 'error' },
          1,
          { help: 'Number of recurrence create/update/delete operations grouped by action and status' }
        );
        if (!mapRecurrenceError(responder, error)) {
          responder.status(500).json({ message: 'Failed to delete recurrence' });
        }
      }
      return;
    }

    if (url.pathname === '/api/scheduling/run' && req.method === 'POST') {
      routeLabel = 'POST /api/scheduling/run';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      const { organizationId } = body;
      if (!organizationId) {
        responder.status(400).json({ message: 'organizationId is required' });
        return;
      }
      if (!(await hasOrgScope(req, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      const user = req.session.user;
      if (!(await canAdministerOrg(user, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      try {
        const suggestion = await schedulingService.runSchedulingJob(body, { createdBy: user && user.id });
        metricsService.incrementCounter(
          'scheduling_jobs_total',
          { status: 'accepted' },
          1,
          { help: 'Number of scheduling jobs triggered grouped by status' }
        );
        auditService.record({
          actorId: user && user.id,
          action: 'scheduling.run',
          subjectType: 'schedulingSuggestion',
          subjectId: suggestion.id,
          organizationId,
          metadata: {
            participantCount: Array.isArray(body.userIds) ? body.userIds.length : 0,
            rangeStart: body.rangeStart,
            rangeEnd: body.rangeEnd
          }
        });
        responder.status(202).json({ suggestion });
      } catch (error) {
        metricsService.incrementCounter(
          'scheduling_jobs_total',
          { status: 'rejected' },
          1,
          { help: 'Number of scheduling jobs triggered grouped by status' }
        );
        if (!mapSchedulingError(responder, error)) {
          responder.status(500).json({ message: 'Failed to start scheduling job' });
        }
      }
      return;
    }

    if (url.pathname === '/api/scheduling/suggestions' && req.method === 'GET') {
      routeLabel = 'GET /api/scheduling/suggestions';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const organizationId = url.searchParams.get('organizationId');
      if (!organizationId) {
        responder.status(400).json({ message: 'organizationId is required' });
        return;
      }
      if (!(await hasOrgScope(req, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      try {
        const suggestions = await schedulingService.listSuggestionsForOrg(organizationId);
        responder.status(200).json({ suggestions });
      } catch (error) {
        if (!mapSchedulingError(responder, error)) {
          responder.status(500).json({ message: 'Failed to list scheduling suggestions' });
        }
      }
      return;
    }

    match = url.pathname.match(/^\/api\/scheduling\/suggestions\/([^/]+)$/);
    if (match && req.method === 'GET') {
      routeLabel = 'GET /api/scheduling/suggestions/:id';
      const suggestionId = match[1];
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const suggestion = await schedulingService.getSuggestion(suggestionId);
      if (!suggestion) {
        responder.status(404).json({ message: 'Suggestion not found' });
        return;
      }
      if (!(await hasOrgScope(req, suggestion.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      responder.status(200).json({ suggestion });
      return;
    }

    match = url.pathname.match(/^\/api\/scheduling\/suggestions\/([^/]+)\/commit$/);
    if (match && req.method === 'POST') {
      routeLabel = 'POST /api/scheduling/suggestions/:id/commit';
      const suggestionId = match[1];
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const suggestion = await schedulingService.getSuggestion(suggestionId);
      if (!suggestion) {
        responder.status(404).json({ message: 'Suggestion not found' });
        return;
      }
      const user = req.session.user;
      if (!(await canAdministerOrg(user, suggestion.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      const { eventOverrides } = body;
      try {
        const result = await schedulingService.commitSuggestion(suggestionId, {
          actorId: user && user.id,
          eventOverrides
        });
        metricsService.incrementCounter(
          'scheduling_commits_total',
          { status: 'success' },
          1,
          { help: 'Number of scheduling suggestion commits grouped by status' }
        );
        auditService.record({
          actorId: user && user.id,
          action: 'scheduling.commit',
          subjectType: 'schedulingSuggestion',
          subjectId: suggestionId,
          organizationId: suggestion.organizationId,
          metadata: {
            eventCount: Array.isArray(result.events) ? result.events.length : 0
          }
        });
        responder.status(200).json(result);
      } catch (error) {
        metricsService.incrementCounter(
          'scheduling_commits_total',
          { status: 'error' },
          1,
          { help: 'Number of scheduling suggestion commits grouped by status' }
        );
        if (!mapSchedulingError(responder, error)) {
          responder.status(500).json({ message: 'Failed to commit suggestion' });
        }
      }
      return;
    }

    if (url.pathname === '/api/ai/parse-jobs' && req.method === 'POST') {
      routeLabel = 'POST /api/ai/parse-jobs';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      const { organizationId, provider, sourceUrl } = body || {};
      if (!organizationId || !provider || !sourceUrl) {
        responder.status(400).json({ message: 'organizationId, provider, and sourceUrl are required' });
        return;
      }
      if (!(await hasOrgScope(req, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      if (!(await canAdministerOrg(req.session.user, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Administrator role required to submit parse jobs' });
        return;
      }
      try {
        const job = await aiParseJobService.submitJob({
          organizationId,
          provider,
          sourceUrl,
          actorId: req.session.user && req.session.user.id
        });
        responder.status(202).json({ job });
      } catch (error) {
        responder.status(500).json({ message: 'Failed to submit parse job' });
      }
      return;
    }

    if (url.pathname === '/api/ai/parse-jobs' && req.method === 'GET') {
      routeLabel = 'GET /api/ai/parse-jobs';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const organizationId = url.searchParams.get('organizationId');
      if (!organizationId) {
        responder.status(400).json({ message: 'organizationId is required' });
        return;
      }
      if (!(await hasOrgScope(req, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      try {
        const jobs = await aiParseJobService.listJobs({ organizationId });
        responder.status(200).json({ jobs });
      } catch (error) {
        responder.status(500).json({ message: 'Failed to list parse jobs' });
      }
      return;
    }

    match = url.pathname.match(/^\/api\/ai\/parse-jobs\/([^/]+)$/);
    if (match && req.method === 'GET') {
      routeLabel = 'GET /api/ai/parse-jobs/:id';
      const jobId = match[1];
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const organizationId = url.searchParams.get('organizationId');
      if (!organizationId) {
        responder.status(400).json({ message: 'organizationId is required' });
        return;
      }
      if (!(await hasOrgScope(req, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      try {
        const job = await aiParseJobService.getJob(jobId, {
          organizationId,
          actorId: req.session.user && req.session.user.id
        });
        if (!job) {
          responder.status(404).json({ message: 'Parse job not found' });
          return;
        }
        responder.status(200).json({ job });
      } catch (error) {
        responder.status(500).json({ message: 'Failed to load parse job' });
      }
      return;
    }

    match = url.pathname.match(/^\/api\/ai\/parse-jobs\/([^/]+)\/review$/);
    if (match && req.method === 'POST') {
      routeLabel = 'POST /api/ai/parse-jobs/:id/review';
      const jobId = match[1];
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      const { organizationId, decision } = body || {};
      if (!organizationId || !decision) {
        responder.status(400).json({ message: 'organizationId and decision are required' });
        return;
      }
      if (!(await hasOrgScope(req, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      if (!(await canAdministerOrg(req.session.user, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Administrator role required to review parse jobs' });
        return;
      }
      const normalizedDecision = String(decision).toUpperCase();
      if (!['APPROVED', 'REJECTED'].includes(normalizedDecision)) {
        responder.status(400).json({ message: 'decision must be APPROVED or REJECTED' });
        return;
      }
      try {
        const job = await aiParseJobService.reviewJob(jobId, normalizedDecision, {
          organizationId,
          actorId: req.session.user && req.session.user.id
        });
        if (!job) {
          responder.status(404).json({ message: 'Parse job not found' });
          return;
        }
        responder.status(200).json({ job });
      } catch (error) {
        responder.status(500).json({ message: 'Failed to review parse job' });
      }
      return;
    }

    if (url.pathname === '/api/tools/execute' && req.method === 'POST') {
      routeLabel = 'POST /api/tools/execute';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      const { tool, payload = {} } = body;
      if (!tool) {
        responder.status(400).json({ message: 'tool is required' });
        return;
      }
      const organizationId = payload && payload.organizationId;
      if (organizationId && !(await hasOrgScope(req, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      try {
        const result = await toolService.execute(tool, payload, {
          actorId: req.session.user && req.session.user.id
        });
        responder.status(200).json({ result });
      } catch (error) {
        if (mapToolError(responder, error)) {
          return;
        }
        if (mapEventError(responder, error)) {
          return;
        }
        responder.status(500).json({ message: 'Failed to execute tool' });
      }
      return;
    }

    if (url.pathname === '/api/notifications' && req.method === 'POST') {
      routeLabel = 'POST /api/notifications';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      const {
        organizationId,
        recipientIds = [],
        subject = null,
        message,
        category = 'general',
        metadata = {}
      } = body || {};
      if (!organizationId) {
        responder.status(400).json({ message: 'organizationId is required' });
        return;
      }
      if (!(await hasOrgScope(req, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      if (!(await canAdministerOrg(req.session.user, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Administrator role required to create notifications' });
        return;
      }
      if (!message || typeof message !== 'string') {
        responder.status(400).json({ message: 'message is required' });
        return;
      }
      const normalizedRecipients = Array.isArray(recipientIds)
        ? Array.from(
            new Set(
              recipientIds
                .filter((id) => typeof id === 'string')
                .map((id) => id.trim())
                .filter((id) => id !== '')
            )
          )
        : [];
      try {
        const notification = await notificationService.createNotification({
          organizationId,
          recipientIds: normalizedRecipients,
          subject,
          message,
          category,
          metadata,
          createdBy: req.session.user && req.session.user.id
        });
        metricsService.incrementCounter(
          'notifications_created_total',
          { category: category || 'general', source: 'manual' },
          1,
          { help: 'Number of notifications created grouped by category and source' }
        );
        auditService.record({
          actorId: req.session.user && req.session.user.id,
          action: 'notification.create',
          subjectType: 'notification',
          subjectId: notification.id,
          organizationId,
          metadata: {
            recipientCount: normalizedRecipients.length,
            category: category || 'general'
          },
          sensitiveFields: ['subject', 'message']
        });
        responder.status(201).json({ notification });
      } catch (error) {
        responder.status(500).json({ message: 'Failed to create notification' });
      }
      return;
    }

    if (url.pathname === '/api/notifications' && req.method === 'GET') {
      routeLabel = 'GET /api/notifications';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const organizationId = url.searchParams.get('organizationId');
      if (organizationId) {
        if (!(await hasOrgScope(req, organizationId, organizationService))) {
          responder.status(403).json({ message: 'Forbidden for organization' });
          return;
        }
        if (!(await canAdministerOrg(req.session.user, organizationId, organizationService))) {
          responder.status(403).json({ message: 'Administrator role required' });
          return;
        }
        const notifications = await notificationService.listByOrganization(organizationId);
        responder.status(200).json({ notifications });
        return;
      }
      const user = req.session.user;
      if (!user || !user.id) {
        responder.status(403).json({ message: 'Authentication required' });
        return;
      }
      const notifications = (await notificationService.listForRecipient(user.id)).map((notification) =>
        sanitizeNotificationForRecipient(notification)
      );
      responder.status(200).json({ notifications });
      return;
    }

    match = url.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if (match && req.method === 'POST') {
      routeLabel = 'POST /api/notifications/:id/read';
      const notificationId = match[1];
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const notification = await notificationService.get(notificationId);
      if (!notification) {
        responder.status(404).json({ message: 'Notification not found' });
        return;
      }
      if (!(await hasOrgScope(req, notification.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      const user = req.session.user;
      if (!user || !user.id) {
        responder.status(403).json({ message: 'Authentication required' });
        return;
      }
      if (!notification.recipientIds.includes(user.id)) {
        responder.status(403).json({ message: 'Recipient required' });
        return;
      }
      try {
        const receipt = await notificationService.markRead({
          notificationId,
          recipientId: user.id
        });
        metricsService.incrementCounter(
          'notifications_reads_total',
          { status: 'success' },
          1,
          { help: 'Number of notification read acknowledgements grouped by status' }
        );
        auditService.record({
          actorId: user.id,
          action: 'notification.read',
          subjectType: 'notification',
          subjectId: notificationId,
          organizationId: notification.organizationId
        });
        responder.status(200).json({ notification: sanitizeNotificationForRecipient(receipt) });
      } catch (error) {
        metricsService.incrementCounter(
          'notifications_reads_total',
          { status: 'error' },
          1,
          { help: 'Number of notification read acknowledgements grouped by status' }
        );
        responder.status(500).json({ message: 'Failed to record read receipt' });
      }
      return;
    }

    if (url.pathname === '/api/queue/jobs' && req.method === 'POST') {
      routeLabel = 'POST /api/queue/jobs';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      const { organizationId, type, payload, priority, maxAttempts, dedupeKey } = body;
      if (!organizationId || !type) {
        responder.status(400).json({ message: 'organizationId and type are required' });
        return;
      }
      if (!(await hasOrgScope(req, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      if (!(await canAdministerOrg(req.session.user, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Administrator role required to enqueue jobs' });
        return;
      }
      try {
        const job = await queueService.enqueueJob({
          organizationId,
          type,
          payload,
          priority: Number.isInteger(priority) ? priority : 0,
          maxAttempts: Number.isInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : 3,
          dedupeKey: typeof dedupeKey === 'string' ? dedupeKey : null,
          createdBy: req.session.user && req.session.user.id
        });
        responder.status(202).json({ job });
      } catch (error) {
        if (!mapQueueError(responder, error)) {
          responder.status(500).json({ message: 'Failed to enqueue job' });
        }
      }
      return;
    }

    if (url.pathname === '/api/queue/jobs' && req.method === 'GET') {
      routeLabel = 'GET /api/queue/jobs';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const user = req.session.user;
      const organizationId = url.searchParams.get('organizationId');
      const status = url.searchParams.get('status');
      const limitParam = url.searchParams.get('limit');
      const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
      if (!organizationId && (!user || user.globalRole !== 'SUPER_ADMIN')) {
        responder.status(400).json({ message: 'organizationId is required for non-super administrators' });
        return;
      }
      if (organizationId && !(await hasOrgScope(req, organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      try {
        const jobs = await queueService.listJobs({
          organizationId: organizationId || null,
          status: status || null,
          limit: Number.isFinite(limit) ? limit : undefined
        });
        responder.status(200).json({ jobs });
      } catch (error) {
        if (!mapQueueError(responder, error)) {
          responder.status(500).json({ message: 'Failed to list jobs' });
        }
      }
      return;
    }

    let queueMatch = url.pathname.match(/^\/api\/queue\/jobs\/([^/]+)$/);
    if (queueMatch && req.method === 'GET') {
      routeLabel = 'GET /api/queue/jobs/:id';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const jobId = queueMatch[1];
      const job = await queueService.getJob(jobId);
      if (!job) {
        responder.status(404).json({ message: 'Job not found' });
        return;
      }
      if (!(await hasOrgScope(req, job.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Forbidden for organization' });
        return;
      }
      responder.status(200).json({ job });
      return;
    }

    queueMatch = url.pathname.match(/^\/api\/queue\/jobs\/([^/]+)\/retry$/);
    if (queueMatch && req.method === 'POST') {
      routeLabel = 'POST /api/queue/jobs/:id/retry';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const jobId = queueMatch[1];
      const job = await queueService.getJob(jobId);
      if (!job) {
        responder.status(404).json({ message: 'Job not found' });
        return;
      }
      if (!(await canAdministerOrg(req.session.user, job.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Administrator role required to retry job' });
        return;
      }
      try {
        const updated = await queueService.retryJob(jobId, {
          actorId: req.session.user && req.session.user.id
        });
        responder.status(200).json({ job: updated });
      } catch (error) {
        if (!mapQueueError(responder, error)) {
          responder.status(500).json({ message: 'Failed to retry job' });
        }
      }
      return;
    }

    queueMatch = url.pathname.match(/^\/api\/queue\/jobs\/([^/]+)\/cancel$/);
    if (queueMatch && req.method === 'POST') {
      routeLabel = 'POST /api/queue/jobs/:id/cancel';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const jobId = queueMatch[1];
      const job = await queueService.getJob(jobId);
      if (!job) {
        responder.status(404).json({ message: 'Job not found' });
        return;
      }
      if (!(await canAdministerOrg(req.session.user, job.organizationId, organizationService))) {
        responder.status(403).json({ message: 'Administrator role required to cancel job' });
        return;
      }
      const body = await readJsonBody(req, responder);
      if (body === undefined) {
        return;
      }
      try {
        const updated = await queueService.cancelJob(jobId, {
          actorId: req.session.user && req.session.user.id,
          reason: typeof body.reason === 'string' ? body.reason : null
        });
        responder.status(200).json({ job: updated });
      } catch (error) {
        if (!mapQueueError(responder, error)) {
          responder.status(500).json({ message: 'Failed to cancel job' });
        }
      }
      return;
    }

    if (url.pathname === '/api/audit' && req.method === 'GET') {
      routeLabel = 'GET /api/audit';
      const proceed = await applyMiddlewares(req, responder, [requireAuth, injectOrgScope()]);
      if (!proceed) {
        return;
      }
      const user = req.session.user;
      const organizationId = url.searchParams.get('organizationId');
      if (!user) {
        responder.status(401).json({ message: 'Authentication required' });
        return;
      }
      if (user.globalRole === 'SUPER_ADMIN') {
        const entries = organizationId
          ? auditService.list({ organizationId })
          : auditService.list();
        metricsService.incrementCounter(
          'audit_queries_total',
          { role: 'SUPER_ADMIN' },
          1,
          { help: 'Number of audit log queries grouped by role' }
        );
        responder.status(200).json({ entries });
        return;
      }
      if (user.globalRole === 'ADMIN') {
        if (!organizationId) {
          responder.status(400).json({ message: 'organizationId is required for admin audit queries' });
          return;
        }
        if (!(await hasOrgScope(req, organizationId, organizationService))) {
          responder.status(403).json({ message: 'Forbidden for organization' });
          return;
        }
        const entries = auditService.list({ organizationId });
        metricsService.incrementCounter(
          'audit_queries_total',
          { role: 'ADMIN' },
          1,
          { help: 'Number of audit log queries grouped by role' }
        );
        responder.status(200).json({ entries });
        return;
      }
      responder.status(403).json({ message: 'Forbidden' });
      return;
    }

    responder.status(404).json({ message: 'Not Found' });
  });

  return {
    listen(callback) {
      server.listen(port, callback);
      return server;
    },
    close(callback) {
      server.close(callback);
    }
  };
}

export { createApp };
