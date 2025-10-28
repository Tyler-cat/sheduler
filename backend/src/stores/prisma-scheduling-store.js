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
    return value ?? null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function cloneJson(value) {
  return value === null || value === undefined ? null : JSON.parse(JSON.stringify(value));
}

class PrismaSchedulingStore {
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
      organizationId: record.orgId,
      solver: record.solver,
      status: record.status,
      createdBy: record.createdBy,
      createdAt: toIso(record.createdAt),
      updatedAt: toIso(record.updatedAt),
      committedAt: toIso(record.committedAt),
      committedBy: record.committedBy ?? null,
      queueJobId: record.queueJobId ?? null,
      inputSnapshot: cloneJson(record.inputSnapshot) ?? {},
      outputPlan: cloneJson(record.outputPlan),
      scoreBreakdown: cloneJson(record.scoreBreakdown),
      errors: Array.isArray(record.errors) ? [...record.errors] : [],
      resultingEventIds: Array.isArray(record.resultingEventIds)
        ? [...record.resultingEventIds]
        : [],
      completedAt: toIso(record.completedAt),
      metadata: cloneJson(record.metadata)
    };
  }

  #toData(suggestion) {
    return {
      id: suggestion.id,
      orgId: suggestion.organizationId,
      solver: suggestion.solver,
      status: suggestion.status,
      createdBy: suggestion.createdBy,
      createdAt: toDate(suggestion.createdAt) ?? new Date(),
      updatedAt: toDate(suggestion.updatedAt) ?? new Date(),
      committedAt: toDate(suggestion.committedAt),
      committedBy: suggestion.committedBy ?? null,
      queueJobId: suggestion.queueJobId ?? null,
      inputSnapshot: suggestion.inputSnapshot ?? {},
      outputPlan: suggestion.outputPlan ?? null,
      scoreBreakdown: suggestion.scoreBreakdown ?? null,
      errors: Array.isArray(suggestion.errors) ? suggestion.errors : [],
      resultingEventIds: Array.isArray(suggestion.resultingEventIds)
        ? suggestion.resultingEventIds
        : [],
      completedAt: toDate(suggestion.completedAt),
      metadata: suggestion.metadata ?? null
    };
  }

  async getSuggestion(id) {
    if (!id) {
      return null;
    }
    const record = await this.prisma.schedulingSuggestion.findUnique({
      where: { id }
    });
    return this.#mapRecord(record);
  }

  async listSuggestionsForOrg(orgId) {
    if (!orgId) {
      return [];
    }
    const records = await this.prisma.schedulingSuggestion.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' }
    });
    return records.map((record) => this.#mapRecord(record));
  }

  async createSuggestion(suggestion) {
    const data = this.#toData(suggestion);
    const record = await this.prisma.schedulingSuggestion.create({
      data
    });
    return this.#mapRecord(record);
  }

  async updateSuggestion(suggestion) {
    const data = this.#toData(suggestion);
    delete data.id;
    const record = await this.prisma.schedulingSuggestion.update({
      where: { id: suggestion.id },
      data
    });
    return this.#mapRecord(record);
  }
}

export { PrismaSchedulingStore };
