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
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => ({ ...entry }));
  }
  return [];
}

class PrismaQueueStore {
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
    return {
      id: record.id,
      organizationId: record.organizationId,
      type: record.type,
      status: record.status,
      priority: record.priority ?? 0,
      payload: record.payload ?? {},
      attempts: record.attempts ?? 0,
      maxAttempts: record.maxAttempts ?? 0,
      dedupeKey: record.dedupeKey ?? null,
      createdBy: record.createdBy ?? null,
      queuedAt: toIso(record.queuedAt),
      startedAt: toIso(record.startedAt),
      completedAt: toIso(record.completedAt),
      workerId: record.workerId ?? null,
      result: record.result ?? null,
      lastError: record.lastError ?? null,
      errorHistory: ensureArray(record.errorHistory),
      createdAt: toIso(record.createdAt),
      updatedAt: toIso(record.updatedAt)
    };
  }

  async create(job) {
    const record = await this.prisma.queueJob.create({
      data: {
        id: job.id,
        organizationId: job.organizationId,
        type: job.type,
        status: job.status ?? 'QUEUED',
        priority: job.priority ?? 0,
        payload: job.payload ?? {},
        attempts: job.attempts ?? 0,
        maxAttempts: job.maxAttempts ?? 3,
        dedupeKey: job.dedupeKey ?? null,
        createdBy: job.createdBy ?? null,
        queuedAt: toDate(job.queuedAt) ?? new Date(),
        startedAt: toDate(job.startedAt),
        completedAt: toDate(job.completedAt),
        workerId: job.workerId ?? null,
        result: job.result ?? null,
        lastError: job.lastError ?? null,
        errorHistory: Array.isArray(job.errorHistory) ? job.errorHistory : [],
        createdAt: toDate(job.createdAt) ?? new Date(),
        updatedAt: toDate(job.updatedAt) ?? new Date()
      }
    });
    return this.#mapRecord(record);
  }

  async update(job) {
    if (!job || !job.id) {
      throw new Error('job id is required for update');
    }
    const record = await this.prisma.queueJob.update({
      where: { id: job.id },
      data: {
        organizationId: job.organizationId,
        type: job.type,
        status: job.status,
        priority: job.priority ?? 0,
        payload: job.payload ?? {},
        attempts: job.attempts ?? 0,
        maxAttempts: job.maxAttempts ?? 3,
        dedupeKey: job.dedupeKey ?? null,
        createdBy: job.createdBy ?? null,
        queuedAt: toDate(job.queuedAt) ?? new Date(),
        startedAt: toDate(job.startedAt),
        completedAt: toDate(job.completedAt),
        workerId: job.workerId ?? null,
        result: job.result ?? null,
        lastError: job.lastError ?? null,
        errorHistory: Array.isArray(job.errorHistory) ? job.errorHistory : [],
        createdAt: toDate(job.createdAt) ?? new Date(),
        updatedAt: toDate(job.updatedAt) ?? new Date()
      }
    });
    return this.#mapRecord(record);
  }

  async get(jobId) {
    if (!jobId) {
      return null;
    }
    const record = await this.prisma.queueJob.findUnique({ where: { id: jobId } });
    return this.#mapRecord(record);
  }

  async list({ organizationId = null, status = null, limit = 50 } = {}) {
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 50;
    const where = {};
    if (organizationId) {
      where.organizationId = organizationId;
    }
    if (status) {
      where.status = status;
    }
    const records = await this.prisma.queueJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: normalizedLimit
    });
    return records.map((record) => this.#mapRecord(record));
  }

  async findActiveByDedupe(dedupeKey) {
    if (!dedupeKey) {
      return null;
    }
    const record = await this.prisma.queueJob.findFirst({
      where: {
        dedupeKey,
        status: 'QUEUED'
      },
      orderBy: { createdAt: 'desc' }
    });
    return this.#mapRecord(record);
  }

  async getQueuedCounts() {
    const groups = await this.prisma.queueJob.groupBy({
      by: ['type'],
      where: { status: 'QUEUED' },
      _count: { _all: true }
    });
    return new Map(groups.map((group) => [group.type, group._count._all]));
  }
}

export { PrismaQueueStore };
