function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createUpsert(store, keyFn, defaults = () => ({})) {
  return async ({ where, update = {}, create = {} }) => {
    const key = keyFn(where, create);
    const existing = store.get(key);
    if (existing) {
      const next = { ...existing, ...clone(update) };
      store.set(key, next);
      return clone(next);
    }
    const next = { ...defaults(create), ...clone(create) };
    store.set(key, next);
    return clone(next);
  };
}

function createMockPrisma() {
  const users = new Map();
  const organizations = new Map();
  const orgBySlug = new Map();
  const orgAdmins = new Map();
  const groups = new Map();
  const groupUnique = new Map();
  const groupMembers = new Map();
  const events = new Map();
  const eventAssignees = new Map();
  const recurrenceRules = new Map();
  const schedulingSuggestions = new Map();
  const availabilityCaches = new Map();
  const queueJobs = new Map();
  const notifications = new Map();
  const notificationRecipients = new Map();
  const notificationsByOrg = new Map();

  const notificationRecipientKey = (notificationId, recipientId) => `${notificationId}:${recipientId}`;

  function cloneNotification(record) {
    if (!record) {
      return null;
    }
    const base = clone(record);
    const recipients = [];
    for (const [key, recipient] of notificationRecipients.entries()) {
      if (key.startsWith(`${record.id}:`)) {
        recipients.push(clone(recipient));
      }
    }
    base.recipients = recipients;
    return base;
  }

  const userModel = {
    upsert: createUpsert(users, (where, create) => where?.id ?? where?.email ?? create.id ?? create.email),
    async count() {
      return users.size;
    }
  };

  const organizationModel = {
    async upsert({ where, update = {}, create = {} }) {
      const slug = where?.slug ?? create.slug;
      const existingId = orgBySlug.get(slug);
      if (existingId) {
        const existing = organizations.get(existingId);
        const next = { ...existing, ...clone(update) };
        organizations.set(existingId, next);
        return clone(next);
      }
      const id = create.id ?? `org_${slug}`;
      const record = { id, ...clone(create) };
      organizations.set(id, record);
      orgBySlug.set(slug, id);
      if (!orgAdmins.has(id)) {
        orgAdmins.set(id, new Map());
      }
      if (!groups.has(id)) {
        groups.set(id, new Map());
      }
      return clone(record);
    },
    async findMany({ include } = {}) {
      const results = Array.from(organizations.values()).map((org) => clone(org));
      if (include?.admins) {
        for (const org of results) {
          const adminMap = orgAdmins.get(org.id) ?? new Map();
          org.admins = Array.from(adminMap.values()).map(clone);
        }
      }
      if (include?.groups) {
        for (const org of results) {
          const groupMap = groups.get(org.id) ?? new Map();
          org.groups = Array.from(groupMap.values()).map(clone);
        }
      }
      return results;
    }
  };

  const organizationAdminModel = {
    async upsert({ where, update = {}, create = {} }) {
      const key = `${where.userId_orgId?.userId ?? create.userId}:${where.userId_orgId?.orgId ?? create.orgId}`;
      const payload = clone(create);
      const orgMap = orgAdmins.get(payload.orgId) ?? new Map();
      const next = { ...orgMap.get(key), ...payload, ...clone(update) };
      orgMap.set(key, next);
      orgAdmins.set(payload.orgId, orgMap);
      return clone(next);
    },
    async count() {
      let total = 0;
      for (const admins of orgAdmins.values()) {
        total += admins.size;
      }
      return total;
    }
  };

  const groupModel = {
    async upsert({ where, update = {}, create = {} }) {
      const key = `${where.orgId_name?.orgId ?? create.orgId}:${where.orgId_name?.name ?? create.name}`;
      const existingId = groupUnique.get(key);
      if (existingId) {
        const existing = groups.get(create.orgId)?.get(existingId);
        const next = { ...existing, ...clone(update) };
        groups.get(create.orgId).set(existingId, next);
        return clone(next);
      }
      const id = create.id ?? `group_${Math.random().toString(16).slice(2)}`;
      const record = { id, ...clone(create) };
      if (!groups.has(record.orgId)) {
        groups.set(record.orgId, new Map());
      }
      groups.get(record.orgId).set(id, record);
      groupUnique.set(key, id);
      return clone(record);
    }
  };

  const groupMemberModel = {
    async upsert({ where, update = {}, create = {} }) {
      const key = `${where.groupId_userId?.groupId ?? create.groupId}:${where.groupId_userId?.userId ?? create.userId}`;
      const next = { ...clone(create), ...clone(update) };
      groupMembers.set(key, next);
      return clone(next);
    }
  };

  const eventModel = {
    upsert: createUpsert(events, (where, create) => where?.id ?? create.id),
    async findUnique({ where, include } = {}) {
      const record = events.get(where.id);
      if (!record) {
        return null;
      }
      const cloned = clone(record);
      if (include?.assignees) {
        const matches = Array.from(eventAssignees.values()).filter((a) => a.eventId === record.id);
        cloned.assignees = clone(matches);
      }
      if (include?.recurrence) {
        const recurrence = recurrenceRules.get(record.id) || null;
        cloned.recurrence = recurrence ? clone(recurrence) : null;
      }
      return cloned;
    }
  };

  const eventAssigneeModel = {
    async upsert({ where, update = {}, create = {} }) {
      const key = `${where.eventId_userId?.eventId ?? create.eventId}:${where.eventId_userId?.userId ?? create.userId}`;
      const next = { ...clone(create), ...clone(update) };
      eventAssignees.set(key, next);
      return clone(next);
    },
    async count() {
      return eventAssignees.size;
    }
  };

  const recurrenceModel = {
    async upsert({ where, update = {}, create = {} }) {
      const id = where?.eventId ?? create.eventId;
      const next = { ...(recurrenceRules.get(id) ?? {}), ...clone(create), ...clone(update) };
      recurrenceRules.set(id, next);
      return clone(next);
    }
  };

  const suggestionModel = {
    upsert: createUpsert(schedulingSuggestions, (where, create) => where?.id ?? create.id),
    async create({ data }) {
      const id = data.id ?? `suggestion_${Math.random().toString(16).slice(2)}`;
      const record = { ...clone(data), id };
      schedulingSuggestions.set(id, record);
      return clone(record);
    },
    async update({ where, data }) {
      const existing = schedulingSuggestions.get(where.id);
      if (!existing) {
        throw new Error('Record not found');
      }
      const next = { ...existing, ...clone(data), id: existing.id };
      schedulingSuggestions.set(existing.id, next);
      return clone(next);
    },
    async findUnique({ where }) {
      return clone(schedulingSuggestions.get(where.id));
    },
    async findMany({ where = {}, orderBy } = {}) {
      const results = [];
      for (const record of schedulingSuggestions.values()) {
        if (where.orgId && record.orgId !== where.orgId) {
          continue;
        }
        results.push(clone(record));
      }
      if (orderBy?.createdAt === 'desc') {
        results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      } else if (orderBy?.createdAt === 'asc') {
        results.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      }
      return results;
    }
  };

  const availabilityModel = {
    upsert: createUpsert(availabilityCaches, (where, create) => where?.id ?? create.id),
    async findFirst({ where = {} } = {}) {
      for (const record of availabilityCaches.values()) {
        if (where.orgId && record.orgId !== where.orgId) {
          continue;
        }
        if (where.userId && record.userId !== where.userId) {
          continue;
        }
        return clone(record);
      }
      return null;
    },
    async create({ data }) {
      const id = data.id ?? `availability_${Math.random().toString(16).slice(2)}`;
      const record = { ...clone(data), id };
      availabilityCaches.set(id, record);
      return clone(record);
    },
    async update({ where, data }) {
      const existing = availabilityCaches.get(where.id);
      if (!existing) {
        throw new Error('Record not found');
      }
      const next = { ...existing, ...clone(data), id: existing.id };
      availabilityCaches.set(existing.id, next);
      return clone(next);
    },
    async findMany({ where = {}, orderBy } = {}) {
      const results = [];
      for (const record of availabilityCaches.values()) {
        if (where.orgId && record.orgId !== where.orgId) {
          continue;
        }
        if (where.userId?.in) {
          if (!where.userId.in.includes(record.userId)) {
            continue;
          }
        } else if (where.userId && record.userId !== where.userId) {
          continue;
        }
        results.push(clone(record));
      }
      if (Array.isArray(orderBy) && orderBy.length > 0) {
        results.sort((a, b) => {
          for (const directive of orderBy) {
            const [[field, direction]] = Object.entries(directive);
            const dir = direction === 'desc' ? -1 : 1;
            if (a[field] === b[field]) {
              continue;
            }
            if (a[field] === undefined) {
              return -dir;
            }
            if (b[field] === undefined) {
              return dir;
            }
            if (a[field] < b[field]) {
              return -dir;
            }
            if (a[field] > b[field]) {
              return dir;
            }
          }
          return 0;
        });
      }
      return results;
    },
    async deleteMany({ where = {} } = {}) {
      let count = 0;
      for (const [id, record] of availabilityCaches.entries()) {
        if (where.orgId && record.orgId !== where.orgId) {
          continue;
        }
        if (where.userId && record.userId !== where.userId) {
          continue;
        }
        availabilityCaches.delete(id);
        count += 1;
      }
      return { count };
    }
  };

  const queueJobModel = {
    async create({ data }) {
      const id = data.id ?? `queue_${Math.random().toString(16).slice(2)}`;
      const record = { ...clone(data), id };
      queueJobs.set(id, record);
      return clone(record);
    },
    async update({ where, data }) {
      const existing = queueJobs.get(where.id);
      if (!existing) {
        throw new Error('Queue job not found');
      }
      const next = { ...existing, ...clone(data), id: existing.id };
      queueJobs.set(existing.id, next);
      return clone(next);
    },
    async findUnique({ where }) {
      const record = queueJobs.get(where.id);
      return record ? clone(record) : null;
    },
    async findMany({ where = {}, orderBy, take } = {}) {
      let results = [];
      for (const record of queueJobs.values()) {
        if (where.organizationId && record.organizationId !== where.organizationId) {
          continue;
        }
        if (where.status) {
          if (typeof where.status === 'object' && Array.isArray(where.status.in)) {
            if (!where.status.in.includes(record.status)) {
              continue;
            }
          } else if (record.status !== where.status) {
            continue;
          }
        }
        if (where.dedupeKey && record.dedupeKey !== where.dedupeKey) {
          continue;
        }
        results.push(clone(record));
      }
      if (orderBy?.createdAt === 'desc') {
        results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      } else if (orderBy?.createdAt === 'asc') {
        results.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      }
      if (Number.isInteger(take) && take > 0) {
        results = results.slice(0, take);
      }
      return results;
    },
    async findFirst(options = {}) {
      const [first] = await this.findMany({ ...options, take: 1 });
      return first ?? null;
    },
    async groupBy({ by, where = {}, _count } = {}) {
      if (!Array.isArray(by) || by.length !== 1 || by[0] !== 'type') {
        throw new Error('Mock groupBy only supports by=["type"]');
      }
      const counts = new Map();
      for (const record of queueJobs.values()) {
        if (where.status) {
          if (typeof where.status === 'object' && Array.isArray(where.status.in)) {
            if (!where.status.in.includes(record.status)) {
              continue;
            }
          } else if (record.status !== where.status) {
            continue;
          }
        }
        const type = record.type;
        counts.set(type, (counts.get(type) || 0) + 1);
      }
      const results = [];
      for (const [type, count] of counts.entries()) {
        const entry = { type };
        if (_count?._all) {
          entry._count = { _all: count };
        }
        results.push(entry);
      }
      return results;
    }
  };

  const notificationModel = {
    async create({ data, include } = {}) {
      const id = data.id ?? `notification_${Math.random().toString(16).slice(2)}`;
      const createdAt = data.createdAt
        ? data.createdAt instanceof Date
          ? data.createdAt.toISOString()
          : data.createdAt
        : new Date().toISOString();
      const record = {
        id,
        organizationId: data.organizationId,
        subject: data.subject ?? null,
        message: data.message,
        category: data.category ?? 'general',
        metadata: clone(data.metadata ?? {}),
        createdBy: data.createdBy ?? null,
        createdAt
      };
      notifications.set(id, record);
      if (!notificationsByOrg.has(record.organizationId)) {
        notificationsByOrg.set(record.organizationId, new Set());
      }
      notificationsByOrg.get(record.organizationId).add(id);
      const recipientCreates = Array.isArray(data.recipients?.create) ? data.recipients.create : [];
      for (const recipient of recipientCreates) {
        const key = notificationRecipientKey(id, recipient.recipientId);
        notificationRecipients.set(key, {
          notificationId: id,
          recipientId: recipient.recipientId,
          readAt: recipient.readAt
            ? recipient.readAt instanceof Date
              ? recipient.readAt.toISOString()
              : recipient.readAt
            : null,
          createdAt: recipient.createdAt
            ? recipient.createdAt instanceof Date
              ? recipient.createdAt.toISOString()
              : recipient.createdAt
            : createdAt
        });
      }
      if (include?.recipients) {
        return cloneNotification(record);
      }
      return clone(record);
    },
    async findMany({ where = {}, orderBy, include } = {}) {
      const results = [];
      for (const record of notifications.values()) {
        if (where.organizationId && record.organizationId !== where.organizationId) {
          continue;
        }
        const recipientFilter = where.recipients?.some?.recipientId;
        if (recipientFilter) {
          const key = notificationRecipientKey(record.id, recipientFilter);
          if (!notificationRecipients.has(key)) {
            continue;
          }
        }
        results.push(include?.recipients ? cloneNotification(record) : clone(record));
      }
      if (orderBy?.createdAt === 'desc') {
        results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      } else if (orderBy?.createdAt === 'asc') {
        results.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      }
      return results;
    },
    async findUnique({ where, include } = {}) {
      const record = notifications.get(where.id);
      if (!record) {
        return null;
      }
      return include?.recipients ? cloneNotification(record) : clone(record);
    }
  };

  const notificationRecipientModel = {
    async update({ where, data }) {
      const key = notificationRecipientKey(
        where.notificationId_recipientId.notificationId,
        where.notificationId_recipientId.recipientId
      );
      const existing = notificationRecipients.get(key);
      if (!existing) {
        const error = new Error('Record not found');
        error.code = 'P2025';
        throw error;
      }
      const updated = {
        ...existing,
        ...clone(data)
      };
      if (updated.readAt instanceof Date) {
        updated.readAt = updated.readAt.toISOString();
      }
      notificationRecipients.set(key, updated);
      return clone(updated);
    }
  };

  return {
    user: userModel,
    organization: organizationModel,
    organizationAdmin: organizationAdminModel,
    group: groupModel,
    groupMember: groupMemberModel,
    event: eventModel,
    eventAssignee: eventAssigneeModel,
    eventRecurrenceRule: recurrenceModel,
    schedulingSuggestion: suggestionModel,
    availabilityCache: availabilityModel,
    queueJob: queueJobModel,
    notification: notificationModel,
    notificationRecipient: notificationRecipientModel,
    async $disconnect() {}
  };
}

export { createMockPrisma };
