import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaOrganizationStore } from '../src/stores/prisma-organization-store.js';

function createPrismaStub() {
  const organizations = new Map();
  const orgBySlug = new Map();
  const orgAdmins = new Map();
  const groups = new Map();
  let orgCounter = 1;
  let groupCounter = 1;

  function clone(value) {
    return value === undefined ? value : structuredClone(value);
  }

  function ensureOrgMap(orgId) {
    if (!orgAdmins.has(orgId)) {
      orgAdmins.set(orgId, new Map());
    }
    if (!groups.has(orgId)) {
      groups.set(orgId, new Map());
    }
  }

  const organization = {
    async create({ data }) {
      if (orgBySlug.has(data.slug)) {
        const error = new Error('Unique constraint failed');
        error.code = 'P2002';
        throw error;
      }
      const id = data.id ?? `org-${orgCounter++}`;
      const record = {
        id,
        name: data.name,
        slug: data.slug,
        status: data.status ?? 'active',
        branding: data.branding ?? null,
        createdAt: data.createdAt ?? new Date().toISOString(),
        updatedAt: data.updatedAt ?? new Date().toISOString()
      };
      organizations.set(id, record);
      orgBySlug.set(record.slug, id);
      ensureOrgMap(id);
      return clone(record);
    },
    async findUnique({ where }) {
      const record = organizations.get(where.id);
      return record ? clone(record) : null;
    },
    async findMany({ orderBy, where } = {}) {
      let values = Array.from(organizations.values());
      if (where?.id?.in) {
        const set = new Set(where.id.in);
        values = values.filter((org) => set.has(org.id));
      }
      if (orderBy?.createdAt === 'asc') {
        values.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      }
      return values.map(clone);
    },
    async update({ where, data }) {
      const record = organizations.get(where.id);
      if (!record) {
        return null;
      }
      const next = { ...record, ...data };
      organizations.set(where.id, next);
      return clone(next);
    }
  };

  const organizationAdmin = {
    async upsert({ where, create, update }) {
      const key = `${where.userId_orgId?.userId ?? create.userId}:${where.userId_orgId?.orgId ?? create.orgId}`;
      ensureOrgMap(create.orgId ?? where.userId_orgId.orgId);
      const map = orgAdmins.get(create.orgId ?? where.userId_orgId.orgId);
      const existing = map.get(key) || { userId: create.userId, orgId: create.orgId };
      const next = { ...existing, ...update };
      map.set(key, next);
      return clone(next);
    },
    async findUnique({ where }) {
      const orgId = where.userId_orgId.orgId;
      const key = `${where.userId_orgId.userId}:${orgId}`;
      const map = orgAdmins.get(orgId);
      const result = map ? map.get(key) : undefined;
      return result ? clone(result) : null;
    },
    async findMany({ where = {}, include } = {}) {
      const results = [];
      if (where.orgId) {
        const map = orgAdmins.get(where.orgId) || new Map();
        for (const assignment of map.values()) {
          if (where.userId && assignment.userId !== where.userId) {
            continue;
          }
          results.push({ ...clone(assignment) });
        }
      } else if (where.userId) {
        for (const map of orgAdmins.values()) {
          for (const assignment of map.values()) {
            if (assignment.userId === where.userId) {
              results.push({ ...clone(assignment) });
            }
          }
        }
      }
      if (include?.org) {
        return results.map((assignment) => ({
          ...assignment,
          org: clone(organizations.get(assignment.orgId))
        }));
      }
      return results;
    }
  };

  const group = {
    async create({ data }) {
      ensureOrgMap(data.orgId);
      const map = groups.get(data.orgId);
      for (const existing of map.values()) {
        if (existing.name.toLowerCase() === data.name.toLowerCase()) {
          const error = new Error('Unique constraint failed');
          error.code = 'P2002';
          throw error;
        }
      }
      const id = data.id ?? `group-${groupCounter++}`;
      const record = {
        id,
        name: data.name,
        orgId: data.orgId,
        createdAt: data.createdAt ?? new Date().toISOString(),
        updatedAt: data.updatedAt ?? new Date().toISOString()
      };
      map.set(id, record);
      return clone(record);
    }
  };

  return {
    organization,
    organizationAdmin,
    group
  };
}

describe('PrismaOrganizationStore', () => {
  it('creates organizations and prevents duplicate slugs', async () => {
    const store = new PrismaOrganizationStore({ prisma: createPrismaStub() });
    const created = await store.createOrganization({ name: 'Acme', slug: 'acme' });
    assert.equal(created.slug, 'acme');
    await assert.rejects(
      store.createOrganization({ name: 'Acme 2', slug: 'acme' }),
      /slug already exists/
    );
  });

  it('manages admins, groups, and scoped listings', async () => {
    const store = new PrismaOrganizationStore({ prisma: createPrismaStub() });
    const org = await store.createOrganization({ name: 'Acme', slug: 'acme' });
    await store.addAdmin(org.id, 'admin-1');
    assert.equal(await store.isAdmin(org.id, 'admin-1'), true);
    assert.deepEqual(await store.listAdmins(org.id), ['admin-1']);

    const group = await store.addGroup(org.id, { name: 'Team A' });
    assert.equal(group.orgId, org.id);
    await assert.rejects(store.addGroup(org.id, { name: 'team a' }), /already exists/);

    const adminView = await store.listOrganizationsForUser({ id: 'admin-1', globalRole: 'ADMIN' });
    assert.equal(adminView.length, 1);
    assert.equal(adminView[0].id, org.id);

    const superView = await store.listOrganizationsForUser({ id: 'super', globalRole: 'SUPER_ADMIN' });
    assert.equal(superView.length, 1);
  });

  it('updates branding metadata', async () => {
    const store = new PrismaOrganizationStore({ prisma: createPrismaStub() });
    const org = await store.createOrganization({ name: 'Beta', slug: 'beta' });
    const updated = await store.updateBranding(org.id, { theme: 'modern' });
    assert.equal(updated.branding.theme, 'modern');
    const fetched = await store.getOrganization(org.id);
    assert.equal(fetched.branding.theme, 'modern');
  });
});
