import { randomUUID } from 'node:crypto';

function cloneRecipients(recipients) {
  if (!Array.isArray(recipients)) {
    return [];
  }
  return recipients.map((recipient) => ({
    recipientId: recipient.recipientId,
    readAt: recipient.readAt ?? null,
    createdAt: recipient.createdAt ?? null
  }));
}

class InMemoryNotificationStore {
  constructor() {
    this.notifications = new Map();
    this.notificationsByOrg = new Map();
    this.notificationsByRecipient = new Map();
  }

  #clone(record) {
    if (!record) {
      return null;
    }
    return {
      id: record.id,
      organizationId: record.organizationId,
      subject: record.subject ?? null,
      message: record.message,
      category: record.category ?? 'general',
      metadata: typeof record.metadata === 'object' && record.metadata !== null ? { ...record.metadata } : {},
      createdBy: record.createdBy ?? null,
      createdAt: record.createdAt,
      recipients: cloneRecipients(record.recipients)
    };
  }

  async create(record) {
    const stored = this.#clone(record);
    stored.recipients = cloneRecipients(record.recipients);
    this.notifications.set(stored.id, stored);
    if (!this.notificationsByOrg.has(stored.organizationId)) {
      this.notificationsByOrg.set(stored.organizationId, new Set());
    }
    this.notificationsByOrg.get(stored.organizationId).add(stored.id);
    for (const recipient of stored.recipients) {
      if (!this.notificationsByRecipient.has(recipient.recipientId)) {
        this.notificationsByRecipient.set(recipient.recipientId, new Set());
      }
      this.notificationsByRecipient.get(recipient.recipientId).add(stored.id);
    }
    return this.#clone(stored);
  }

  async listByOrganization(organizationId) {
    if (!organizationId) {
      return [];
    }
    const ids = this.notificationsByOrg.get(organizationId);
    if (!ids) {
      return [];
    }
    return Array.from(ids)
      .map((id) => this.notifications.get(id))
      .filter(Boolean)
      .map((record) => this.#clone(record))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async listForRecipient(recipientId) {
    if (!recipientId) {
      return [];
    }
    const ids = this.notificationsByRecipient.get(recipientId);
    if (!ids) {
      return [];
    }
    return Array.from(ids)
      .map((id) => this.notifications.get(id))
      .filter(Boolean)
      .map((record) => this.#clone(record))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async get(notificationId) {
    if (!notificationId) {
      return null;
    }
    const record = this.notifications.get(notificationId);
    return record ? this.#clone(record) : null;
  }

  async markRead(notificationId, recipientId, readAt) {
    if (!notificationId || !recipientId) {
      return null;
    }
    const record = this.notifications.get(notificationId);
    if (!record) {
      return null;
    }
    const recipient = record.recipients.find((entry) => entry.recipientId === recipientId);
    if (!recipient) {
      return null;
    }
    recipient.readAt = readAt;
    return this.#clone(record);
  }
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

function sanitizeRecipientIds(recipientIds) {
  if (!Array.isArray(recipientIds)) {
    return [];
  }
  return Array.from(
    new Set(
      recipientIds
        .filter((id) => typeof id === 'string')
        .map((id) => id.trim())
        .filter((id) => id !== '')
    )
  );
}

class NotificationService {
  constructor({ store, idGenerator = randomUUID, clock = () => new Date() } = {}) {
    this.store = store || new InMemoryNotificationStore();
    this.idGenerator = idGenerator;
    this.clock = clock;
  }

  #toOrgView(record) {
    if (!record) {
      return null;
    }
    const readReceipts = {};
    for (const recipient of record.recipients) {
      if (recipient.readAt) {
        readReceipts[recipient.recipientId] = recipient.readAt;
      }
    }
    return {
      id: record.id,
      organizationId: record.organizationId,
      recipientIds: record.recipients.map((recipient) => recipient.recipientId),
      subject: record.subject ?? null,
      message: record.message,
      category: record.category ?? 'general',
      metadata: normalizeMetadata(record.metadata),
      createdBy: record.createdBy ?? null,
      createdAt: record.createdAt,
      readReceipts
    };
  }

  #toRecipientView(record, recipientId) {
    if (!record) {
      return null;
    }
    const orgView = this.#toOrgView(record);
    if (!orgView) {
      return null;
    }
    const recipient = record.recipients.find((entry) => entry.recipientId === recipientId);
    return {
      ...orgView,
      readAt: recipient ? recipient.readAt ?? null : null
    };
  }

  async createNotification({
    organizationId,
    recipientIds = [],
    subject = null,
    message,
    category = 'general',
    createdBy = null,
    metadata = {}
  }) {
    if (!organizationId) {
      throw new Error('organizationId is required');
    }
    if (!message) {
      throw new Error('message is required');
    }
    const normalizedRecipients = sanitizeRecipientIds(recipientIds);
    const createdAt = this.clock().toISOString();
    const notificationRecord = {
      id: this.idGenerator(),
      organizationId,
      subject,
      message,
      category: category || 'general',
      metadata: normalizeMetadata(metadata),
      createdBy,
      createdAt,
      recipients: normalizedRecipients.map((recipientId) => ({
        recipientId,
        readAt: null,
        createdAt
      }))
    };
    const stored = await this.store.create(notificationRecord);
    return this.#toOrgView(stored);
  }

  async listByOrganization(organizationId) {
    const records = await this.store.listByOrganization(organizationId);
    return records.map((record) => this.#toOrgView(record)).filter(Boolean);
  }

  async listForRecipient(recipientId) {
    const records = await this.store.listForRecipient(recipientId);
    return records.map((record) => this.#toRecipientView(record, recipientId)).filter(Boolean);
  }

  async get(notificationId) {
    const record = await this.store.get(notificationId);
    return this.#toOrgView(record);
  }

  async markRead({ notificationId, recipientId }) {
    if (!notificationId) {
      throw new Error('notificationId is required');
    }
    if (!recipientId) {
      throw new Error('recipientId is required');
    }
    const readAt = this.clock().toISOString();
    const record = await this.store.markRead(notificationId, recipientId, readAt);
    if (!record) {
      const error = new Error('Notification not found');
      error.code = 'NOTIFICATION_NOT_FOUND';
      throw error;
    }
    const recipients = record.recipients.map((entry) => entry.recipientId);
    if (!recipients.includes(recipientId)) {
      const error = new Error('Recipient is not authorized for notification');
      error.code = 'NOTIFICATION_FORBIDDEN';
      throw error;
    }
    return this.#toRecipientView(record, recipientId);
  }
}

export { NotificationService, InMemoryNotificationStore };
