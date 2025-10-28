class ToolService {
  constructor({
    organizationService,
    eventService,
    notificationService,
    auditService = null,
    metricsService = null
  }) {
    if (!organizationService) {
      throw new Error('organizationService is required');
    }
    if (!eventService) {
      throw new Error('eventService is required');
    }
    if (!notificationService) {
      throw new Error('notificationService is required');
    }
    this.organizationService = organizationService;
    this.eventService = eventService;
    this.notificationService = notificationService;
    this.auditService = auditService;
    this.metricsService = metricsService;
  }

  async execute(tool, payload = {}, context = {}) {
    switch (tool) {
      case 'notify_admin':
        return await this.#notifyAdmins(payload, context);
      case 'update_personal_schedule':
        return await this.#updatePersonalSchedule(payload, context);
      default: {
        const error = new Error(`Unsupported tool: ${tool}`);
        error.code = 'TOOL_UNSUPPORTED';
        throw error;
      }
    }
  }

  async #notifyAdmins(payload, context) {
    const { organizationId, subject = null, message, metadata = {} } = payload || {};
    if (!organizationId) {
      const error = new Error('organizationId is required');
      error.code = 'TOOL_INVALID_ARGUMENT';
      error.field = 'organizationId';
      throw error;
    }
    if (!message) {
      const error = new Error('message is required');
      error.code = 'TOOL_INVALID_ARGUMENT';
      error.field = 'message';
      throw error;
    }
    const organization = await this.organizationService.getOrganization(organizationId);
    if (!organization) {
      const error = new Error('Organization not found');
      error.code = 'TOOL_ORG_NOT_FOUND';
      throw error;
    }
    const admins = await this.organizationService.listAdmins(organizationId);
    const notification = await this.notificationService.createNotification({
      organizationId,
      recipientIds: admins,
      subject,
      message,
      category: 'admin_alert',
      createdBy: context.actorId || null,
      metadata
    });
    if (this.metricsService) {
      this.metricsService.incrementCounter(
        'tool_executions_total',
        { tool: 'notify_admin' },
        1,
        { help: 'Number of tool executions grouped by tool name' }
      );
    }
    if (this.metricsService) {
      this.metricsService.incrementCounter(
        'notifications_created_total',
        { category: 'admin_alert' },
        1,
        { help: 'Number of notifications created grouped by category' }
      );
    }
    if (this.auditService) {
      this.auditService.record({
        actorId: context.actorId || null,
        action: 'tool.notify_admin',
        subjectType: 'notification',
        subjectId: notification.id,
        organizationId,
        metadata: {
          messagePreview: typeof message === 'string' ? message.slice(0, 32) : null,
          recipientCount: admins.length
        }
      });
    }
    return {
      tool: 'notify_admin',
      notification,
      recipients: admins,
      status: admins.length ? 'DELIVERED' : 'NO_RECIPIENTS'
    };
  }

  async #updatePersonalSchedule(payload, context) {
    const {
      organizationId,
      title,
      start,
      end,
      color = null,
      description = null,
      metadata = {}
    } = payload || {};
    if (!organizationId) {
      const error = new Error('organizationId is required');
      error.code = 'TOOL_INVALID_ARGUMENT';
      error.field = 'organizationId';
      throw error;
    }
    if (!title) {
      const error = new Error('title is required');
      error.code = 'TOOL_INVALID_ARGUMENT';
      error.field = 'title';
      throw error;
    }
    if (!start || !end) {
      const error = new Error('start and end are required');
      error.code = 'TOOL_INVALID_ARGUMENT';
      error.field = 'timeRange';
      throw error;
    }
    if (!context.actorId) {
      const error = new Error('actorId is required to update personal schedule');
      error.code = 'TOOL_MISSING_ACTOR';
      throw error;
    }
    const organization = await this.organizationService.getOrganization(organizationId);
    if (!organization) {
      const error = new Error('Organization not found');
      error.code = 'TOOL_ORG_NOT_FOUND';
      throw error;
    }
    const event = await this.eventService.createEvent({
      organizationId,
      title,
      start,
      end,
      color,
      description,
      assigneeIds: [context.actorId],
      createdBy: context.actorId,
      metadata
    });
    if (this.metricsService) {
      this.metricsService.incrementCounter(
        'tool_executions_total',
        { tool: 'update_personal_schedule' },
        1,
        { help: 'Number of tool executions grouped by tool name' }
      );
    }
    if (this.auditService) {
      this.auditService.record({
        actorId: context.actorId || null,
        action: 'tool.update_personal_schedule',
        subjectType: 'event',
        subjectId: event.id,
        organizationId,
        metadata: {
          title,
          start,
          end
        },
        sensitiveFields: ['title']
      });
    }
    return {
      tool: 'update_personal_schedule',
      event
    };
  }
}

export { ToolService };
