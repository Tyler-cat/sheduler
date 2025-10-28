function toIso(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }
  return date.toISOString();
}

function normalizeMetadata(metadata) {
  if (metadata === null || metadata === undefined) {
    return {};
  }
  if (typeof metadata !== 'object') {
    return {};
  }
  if (Array.isArray(metadata)) {
    return metadata;
  }
  return { ...metadata };
}

function cloneRecord(record) {
  if (!record) {
    return null;
  }
  return {
    id: record.id,
    organizationId: record.organizationId,
    subject: record.subject ?? null,
    message: record.message,
    category: record.category ?? 'general',
    metadata: normalizeMetadata(record.metadata),
    createdBy: record.createdBy ?? null,
    createdAt: toIso(record.createdAt),
    recipients: Array.isArray(record.recipients)
      ? record.recipients.map((recipient) => ({
          recipientId: recipient.recipientId,
          readAt: toIso(recipient.readAt),
          createdAt: toIso(recipient.createdAt)
        }))
      : []
  };
}

class PrismaNotificationStore {
  constructor({ prisma } = {}) {
    if (!prisma) {
      throw new Error('prisma client is required');
    }
    this.prisma = prisma;
  }

  async create(record) {
    const recipients = Array.isArray(record.recipients) ? record.recipients : [];
    const created = await this.prisma.notification.create({
      data: {
        id: record.id,
        organizationId: record.organizationId,
        subject: record.subject ?? null,
        message: record.message,
        category: record.category ?? 'general',
        metadata: normalizeMetadata(record.metadata),
        createdBy: record.createdBy ?? null,
        createdAt: record.createdAt ? new Date(record.createdAt) : undefined,
        recipients: {
          create: recipients.map((recipient) => ({
            recipientId: recipient.recipientId,
            readAt: recipient.readAt ? new Date(recipient.readAt) : null,
            createdAt: recipient.createdAt ? new Date(recipient.createdAt) : undefined
          }))
        }
      },
      include: {
        recipients: true
      }
    });
    return cloneRecord(created);
  }

  async listByOrganization(organizationId) {
    if (!organizationId) {
      return [];
    }
    const records = await this.prisma.notification.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: { recipients: true }
    });
    return records.map((record) => cloneRecord(record));
  }

  async listForRecipient(recipientId) {
    if (!recipientId) {
      return [];
    }
    const records = await this.prisma.notification.findMany({
      where: {
        recipients: {
          some: { recipientId }
        }
      },
      orderBy: { createdAt: 'desc' },
      include: { recipients: true }
    });
    return records.map((record) => cloneRecord(record));
  }

  async get(notificationId) {
    if (!notificationId) {
      return null;
    }
    const record = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: { recipients: true }
    });
    return cloneRecord(record);
  }

  async markRead(notificationId, recipientId, readAt) {
    if (!notificationId || !recipientId) {
      return null;
    }
    try {
      await this.prisma.notificationRecipient.update({
        where: {
          notificationId_recipientId: {
            notificationId,
            recipientId
          }
        },
        data: {
          readAt: readAt ? new Date(readAt) : new Date()
        }
      });
    } catch (error) {
      if (error && error.code === 'P2025') {
        return null;
      }
      throw error;
    }
    const record = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: { recipients: true }
    });
    return cloneRecord(record);
  }
}

export { PrismaNotificationStore, cloneRecord as cloneNotificationRecord };
