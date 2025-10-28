import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaEventStore } from '../src/stores/prisma-event-store.js';

function createPrismaStub() {
  const events = new Map();
  const assignees = new Map();
  let eventCounter = 0;

  function clone(value) {
    return value === undefined ? value : structuredClone(value);
  }

  function ensureAssigneeMap(eventId) {
    if (!assignees.has(eventId)) {
      assignees.set(eventId, new Map());
    }
    return assignees.get(eventId);
  }

  const eventModel = {
    async create({ data }) {
      const id = data.id ?? `event-${++eventCounter}`;
      const record = {
        ...clone(data),
        id
      };
      events.set(id, record);
      return clone(record);
    },
    async findUnique({ where, include } = {}) {
      const record = events.get(where.id);
      if (!record) {
        return null;
      }
      const cloned = clone(record);
      if (include?.assignees) {
        const map = assignees.get(record.id) ?? new Map();
        cloned.assignees = Array.from(map.values()).map(clone);
      }
      return cloned;
    },
    async findMany({ where = {}, include, orderBy } = {}) {
      let rows = Array.from(events.values()).map(clone);
      if (where.organizationId) {
        rows = rows.filter((row) => row.organizationId === where.organizationId);
      }
      if (where.id?.not) {
        rows = rows.filter((row) => row.id !== where.id.not);
      }
      if (where.assignees?.some?.userId?.in) {
        const userIds = new Set(where.assignees.some.userId.in);
        rows = rows.filter((row) => {
          const map = assignees.get(row.id) ?? new Map();
          for (const id of userIds) {
            if (map.has(id)) {
              return true;
            }
          }
          return false;
        });
      }
      if (Array.isArray(where.NOT)) {
        rows = rows.filter((row) => {
          return !where.NOT.some((condition) => {
            if (condition.end?.lte) {
              return new Date(row.end) <= condition.end.lte;
            }
            if (condition.start?.gte) {
              return new Date(row.start) >= condition.start.gte;
            }
            return false;
          });
        });
      }
      if (where.end?.gt) {
        rows = rows.filter((row) => new Date(row.end) > where.end.gt);
      }
      if (where.start?.lt) {
        rows = rows.filter((row) => new Date(row.start) < where.start.lt);
      }
      if (include?.assignees) {
        rows = rows.map((row) => ({
          ...row,
          assignees: Array.from((assignees.get(row.id) ?? new Map()).values()).map(clone)
        }));
      }
      if (orderBy?.start === 'asc') {
        rows.sort((a, b) => new Date(a.start) - new Date(b.start));
      }
      return rows;
    },
    async update({ where, data }) {
      const record = events.get(where.id);
      if (!record) {
        return null;
      }
      const next = { ...record, ...clone(data) };
      events.set(where.id, next);
      return clone(next);
    },
    async delete({ where }) {
      const record = events.get(where.id);
      events.delete(where.id);
      assignees.delete(where.id);
      return clone(record);
    }
  };

  const eventAssigneeModel = {
    async create({ data }) {
      const map = ensureAssigneeMap(data.eventId);
      map.set(data.userId, clone(data));
      return clone(data);
    },
    async deleteMany({ where }) {
      if (where?.eventId) {
        assignees.delete(where.eventId);
      }
    }
  };

  const prisma = {
    event: eventModel,
    eventAssignee: eventAssigneeModel,
    async $transaction(callback) {
      return await callback(prisma);
    }
  };

  return prisma;
}

describe('PrismaEventStore', () => {
  it('creates, lists, and retrieves events with assignees', async () => {
    const prisma = createPrismaStub();
    const store = new PrismaEventStore({ prisma });
    const created = await store.createEvent({
      id: 'event-1',
      organizationId: 'org-1',
      title: 'Kickoff',
      start: '2024-05-01T09:00:00Z',
      end: '2024-05-01T10:00:00Z',
      assigneeIds: ['user-1', 'user-2'],
      createdBy: 'admin-1',
      updatedBy: 'admin-1',
      version: 1,
      createdAt: '2024-04-01T00:00:00Z',
      updatedAt: '2024-04-01T00:00:00Z'
    });
    assert.equal(created.id, 'event-1');
    assert.deepEqual(created.assigneeIds, ['user-1', 'user-2']);

    const fetched = await store.getEvent('event-1');
    assert.equal(fetched.title, 'Kickoff');

    const listed = await store.listEvents({ organizationId: 'org-1' });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, 'event-1');
  });

  it('detects conflicts for overlapping assignees', async () => {
    const prisma = createPrismaStub();
    const store = new PrismaEventStore({ prisma });
    await store.createEvent({
      id: 'event-1',
      organizationId: 'org-1',
      title: 'Existing',
      start: '2024-06-01T09:00:00Z',
      end: '2024-06-01T10:00:00Z',
      assigneeIds: ['user-1'],
      createdBy: 'admin-1',
      updatedBy: 'admin-1',
      createdAt: '2024-05-01T00:00:00Z',
      updatedAt: '2024-05-01T00:00:00Z',
      version: 1
    });
    const conflicts = await store.findConflicts({
      organizationId: 'org-1',
      assigneeIds: ['user-1'],
      start: '2024-06-01T09:30:00Z',
      end: '2024-06-01T11:00:00Z'
    });
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].eventId, 'event-1');
  });

  it('updates and deletes events while maintaining assignee lists', async () => {
    const prisma = createPrismaStub();
    const store = new PrismaEventStore({ prisma });
    await store.createEvent({
      id: 'event-1',
      organizationId: 'org-1',
      title: 'Initial',
      start: '2024-07-01T09:00:00Z',
      end: '2024-07-01T10:00:00Z',
      assigneeIds: ['user-1'],
      createdBy: 'admin-1',
      updatedBy: 'admin-1',
      createdAt: '2024-05-01T00:00:00Z',
      updatedAt: '2024-05-01T00:00:00Z',
      version: 1
    });
    const updated = await store.updateEvent({
      id: 'event-1',
      organizationId: 'org-1',
      title: 'Updated',
      start: '2024-07-01T09:30:00Z',
      end: '2024-07-01T11:00:00Z',
      assigneeIds: ['user-2'],
      createdBy: 'admin-1',
      updatedBy: 'admin-2',
      createdAt: '2024-05-01T00:00:00Z',
      updatedAt: '2024-05-02T00:00:00Z',
      version: 2
    });
    assert.equal(updated.title, 'Updated');
    assert.deepEqual(updated.assigneeIds, ['user-2']);

    await store.deleteEvent('event-1');
    const afterDelete = await store.getEvent('event-1');
    assert.equal(afterDelete, null);
  });
});
