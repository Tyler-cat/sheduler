import { randomUUID } from 'node:crypto';

function toDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

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

function normalizeBusyArray(busy) {
  if (!Array.isArray(busy)) {
    return [];
  }
  return busy
    .map((item) => ({
      start: toIso(item.start),
      end: toIso(item.end),
      source: item.source || 'cache',
      referenceId: item.referenceId || null,
      label: item.label || null
    }))
    .filter((item) => item.start && item.end);
}

class PrismaAvailabilityStore {
  constructor({ prisma, clock = () => new Date(), idGenerator = randomUUID } = {}) {
    if (!prisma) {
      throw new Error('prisma client is required');
    }
    this.prisma = prisma;
    this.clock = clock;
    this.idGenerator = idGenerator;
  }

  #mapRecord(record) {
    if (!record) {
      return null;
    }
    const busy = Array.isArray(record.freeBusyJson?.busy) ? record.freeBusyJson.busy : [];
    return {
      id: record.id,
      organizationId: record.orgId,
      userId: record.userId,
      source: record.source,
      rangeStart: toIso(record.rangeStart),
      rangeEnd: toIso(record.rangeEnd),
      busy: normalizeBusyArray(busy),
      updatedAt: toIso(record.refreshedAt),
      checksum: record.checksum ?? null
    };
  }

  #toData(record) {
    const refreshedAt = toDate(record.updatedAt) ?? this.clock();
    const busy = normalizeBusyArray(record.busy);
    return {
      id: record.id ?? undefined,
      orgId: record.organizationId,
      userId: record.userId,
      source: record.source ?? 'external',
      rangeStart: toDate(record.rangeStart) ?? new Date(),
      rangeEnd: toDate(record.rangeEnd) ?? new Date(),
      freeBusyJson: { busy },
      checksum: record.checksum ?? null,
      refreshedAt
    };
  }

  async upsertCacheRecord(record) {
    const data = this.#toData(record);
    const existing = await this.prisma.availabilityCache.findFirst({
      where: {
        orgId: data.orgId,
        userId: data.userId
      }
    });
    if (existing) {
      const updated = await this.prisma.availabilityCache.update({
        where: { id: existing.id },
        data: {
          source: data.source,
          rangeStart: data.rangeStart,
          rangeEnd: data.rangeEnd,
          freeBusyJson: data.freeBusyJson,
          checksum: data.checksum,
          refreshedAt: data.refreshedAt
        }
      });
      return this.#mapRecord(updated);
    }
    const created = await this.prisma.availabilityCache.create({
      data: {
        id: data.id ?? this.idGenerator(),
        orgId: data.orgId,
        userId: data.userId,
        source: data.source,
        rangeStart: data.rangeStart,
        rangeEnd: data.rangeEnd,
        freeBusyJson: data.freeBusyJson,
        checksum: data.checksum,
        refreshedAt: data.refreshedAt
      }
    });
    return this.#mapRecord(created);
  }

  async getCacheRecord({ organizationId, userId }) {
    if (!organizationId || !userId) {
      return null;
    }
    const record = await this.prisma.availabilityCache.findFirst({
      where: { orgId: organizationId, userId }
    });
    return this.#mapRecord(record);
  }

  async listCacheRecords({ organizationId, userIds = [] } = {}) {
    if (!organizationId) {
      return [];
    }
    const where = { orgId: organizationId };
    if (Array.isArray(userIds) && userIds.length > 0) {
      where.userId = { in: userIds.filter((value) => typeof value === 'string' && value) };
      if (where.userId.in.length === 0) {
        delete where.userId;
      }
    }
    const records = await this.prisma.availabilityCache.findMany({
      where,
      orderBy: [
        { userId: 'asc' },
        { refreshedAt: 'desc' }
      ]
    });
    return records.map((record) => this.#mapRecord(record));
  }

  async deleteCacheRecord({ organizationId, userId }) {
    if (!organizationId || !userId) {
      return false;
    }
    const result = await this.prisma.availabilityCache.deleteMany({
      where: { orgId: organizationId, userId }
    });
    return (result?.count ?? 0) > 0;
  }
}

export { PrismaAvailabilityStore };
