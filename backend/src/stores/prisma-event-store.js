function toDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }
  return date;
}

function toIso(value) {
  if (!value) {
    return value ?? null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

class PrismaEventStore {
  constructor({ prisma } = {}) {
    if (!prisma) {
      throw new Error('prisma client is required');
    }
    this.prisma = prisma;
  }

  #mapRecord(record) {
    if (!record) {
      return null;
    }
    const assigneeIds = Array.isArray(record.assignees)
      ? record.assignees.map((assignee) => assignee.userId)
      : [];
    return {
      id: record.id,
      organizationId: record.organizationId,
      title: record.title,
      description: record.description ?? null,
      start: toIso(record.start),
      end: toIso(record.end),
      allDay: Boolean(record.allDay),
      color: record.color ?? null,
      visibility: record.visibility ?? 'private',
      createdBy: record.createdBy || null,
      updatedBy: record.updatedBy || null,
      version: record.version ?? 1,
      createdAt: toIso(record.createdAt),
      updatedAt: toIso(record.updatedAt),
      assigneeIds,
      metadata: record.metadata ?? null,
      groupId: record.groupId ?? null
    };
  }

  async getEvent(eventId) {
    if (!eventId) {
      return null;
    }
    const record = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { assignees: true }
    });
    return this.#mapRecord(record);
  }

  async listEvents({ organizationId, start, end } = {}) {
    if (!organizationId) {
      return [];
    }
    const where = { organizationId };
    const startDate = start ? toDate(start) : null;
    const endDate = end ? toDate(end) : null;
    if (startDate && endDate) {
      where.NOT = [
        { end: { lte: startDate } },
        { start: { gte: endDate } }
      ];
    } else if (startDate) {
      where.end = { gt: startDate };
    } else if (endDate) {
      where.start = { lt: endDate };
    }
    const records = await this.prisma.event.findMany({
      where,
      include: { assignees: true },
      orderBy: { start: 'asc' }
    });
    return records.map((record) => this.#mapRecord(record));
  }

  async findConflicts({ organizationId, assigneeIds, start, end, excludeEventId } = {}) {
    if (!organizationId || !Array.isArray(assigneeIds) || assigneeIds.length === 0) {
      return [];
    }
    const startDate = toDate(start);
    const endDate = toDate(end);
    const records = await this.prisma.event.findMany({
      where: {
        organizationId,
        id: excludeEventId ? { not: excludeEventId } : undefined,
        assignees: {
          some: {
            userId: { in: assigneeIds }
          }
        },
        NOT:
          startDate && endDate
            ? [
                { end: { lte: startDate } },
                { start: { gte: endDate } }
              ]
            : undefined,
        end: !startDate || endDate ? undefined : { gt: startDate },
        start: !endDate || startDate ? undefined : { lt: endDate }
      },
      include: { assignees: true }
    });
    const conflicts = [];
    for (const record of records) {
      const eventStart = toDate(record.start);
      const eventEnd = toDate(record.end);
      if (!eventStart || !eventEnd) {
        continue;
      }
      if (!startDate || !endDate || overlaps(startDate, endDate, eventStart, eventEnd)) {
        const overlapping = record.assignees
          .map((assignee) => assignee.userId)
          .filter((userId) => assigneeIds.includes(userId));
        if (overlapping.length) {
          conflicts.push({
            eventId: record.id,
            assigneeIds: overlapping,
            start: toIso(record.start),
            end: toIso(record.end)
          });
        }
      }
    }
    return conflicts;
  }

  async createEvent(event) {
    const result = await this.#withClient(async (client) => {
      const created = await client.event.create({
        data: {
          id: event.id,
          organizationId: event.organizationId,
          groupId: event.groupId ?? null,
          title: event.title,
          description: event.description ?? null,
          start: toDate(event.start) ?? new Date(event.start),
          end: toDate(event.end) ?? new Date(event.end),
          allDay: Boolean(event.allDay),
          color: event.color ?? null,
          visibility: event.visibility ?? 'private',
          createdBy: event.createdBy || null,
          updatedBy: event.updatedBy || null,
          version: event.version ?? 1,
          metadata: event.metadata ?? null,
          createdAt: toDate(event.createdAt) ?? new Date(event.createdAt),
          updatedAt: toDate(event.updatedAt) ?? new Date(event.updatedAt)
        }
      });
      await client.eventAssignee.deleteMany({ where: { eventId: created.id } });
      if (Array.isArray(event.assigneeIds) && event.assigneeIds.length) {
        for (const userId of event.assigneeIds) {
          await client.eventAssignee.create({ data: { eventId: created.id, userId } });
        }
      }
      const stored = await client.event.findUnique({
        where: { id: created.id },
        include: { assignees: true }
      });
      return stored;
    });
    return this.#mapRecord(result);
  }

  async updateEvent(event) {
    const result = await this.#withClient(async (client) => {
      await client.event.update({
        where: { id: event.id },
        data: {
          title: event.title,
          description: event.description ?? null,
          start: toDate(event.start) ?? new Date(event.start),
          end: toDate(event.end) ?? new Date(event.end),
          allDay: Boolean(event.allDay),
          color: event.color ?? null,
          visibility: event.visibility ?? 'private',
          updatedBy: event.updatedBy || null,
          version: event.version ?? 1,
          metadata: event.metadata ?? null,
          updatedAt: toDate(event.updatedAt) ?? new Date(event.updatedAt)
        }
      });
      await client.eventAssignee.deleteMany({ where: { eventId: event.id } });
      if (Array.isArray(event.assigneeIds) && event.assigneeIds.length) {
        for (const userId of event.assigneeIds) {
          await client.eventAssignee.create({ data: { eventId: event.id, userId } });
        }
      }
      const stored = await client.event.findUnique({
        where: { id: event.id },
        include: { assignees: true }
      });
      return stored;
    });
    return this.#mapRecord(result);
  }

  async deleteEvent(eventId) {
    await this.#withClient(async (client) => {
      await client.eventAssignee.deleteMany({ where: { eventId } });
      await client.event.delete({ where: { id: eventId } });
    });
  }

  async #withClient(callback) {
    if (typeof this.prisma.$transaction === 'function') {
      return await this.prisma.$transaction((tx) => callback(tx));
    }
    return await callback(this.prisma);
  }
}

export { PrismaEventStore };
