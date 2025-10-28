import { randomUUID } from 'node:crypto';

class InMemoryOrganizationStore {
  constructor({ idGenerator = randomUUID } = {}) {
    this.idGenerator = idGenerator;
    this.organizations = new Map();
    this.orgBySlug = new Map();
    this.adminsByOrg = new Map();
    this.groupsByOrg = new Map();
  }

  async createOrganization({ name, slug, status = 'active', branding = null }) {
    if (!name || !slug) {
      throw new Error('name and slug are required');
    }
    if (this.orgBySlug.has(slug)) {
      const err = new Error('Organization slug already exists');
      err.code = 'ORG_DUPLICATE_SLUG';
      throw err;
    }
    const now = new Date();
    const id = this.idGenerator();
    const organization = {
      id,
      name,
      slug,
      status,
      branding,
      createdAt: now,
      updatedAt: now
    };
    this.organizations.set(id, organization);
    this.orgBySlug.set(slug, organization);
    this.adminsByOrg.set(id, new Set());
    this.groupsByOrg.set(id, new Map());
    return organization;
  }

  async addAdmin(orgId, userId) {
    const organization = this.organizations.get(orgId);
    if (!organization) {
      const err = new Error('Organization not found');
      err.code = 'ORG_NOT_FOUND';
      throw err;
    }
    if (!userId) {
      throw new Error('userId is required');
    }
    const admins = this.adminsByOrg.get(orgId);
    admins.add(userId);
    return { orgId, userId };
  }

  async isAdmin(orgId, userId) {
    const admins = this.adminsByOrg.get(orgId);
    if (!admins) {
      return false;
    }
    return admins.has(userId);
  }

  async listAdmins(orgId) {
    const admins = this.adminsByOrg.get(orgId);
    if (!admins) {
      return [];
    }
    return Array.from(admins);
  }

  async addGroup(orgId, { name }) {
    if (!name) {
      throw new Error('name is required');
    }
    const organization = this.organizations.get(orgId);
    if (!organization) {
      const err = new Error('Organization not found');
      err.code = 'ORG_NOT_FOUND';
      throw err;
    }
    const groups = this.groupsByOrg.get(orgId);
    for (const group of groups.values()) {
      if (group.name.toLowerCase() === name.toLowerCase()) {
        const err = new Error('Group name already exists in organization');
        err.code = 'GROUP_DUPLICATE_NAME';
        throw err;
      }
    }
    const id = this.idGenerator();
    const now = new Date();
    const group = {
      id,
      name,
      orgId,
      createdAt: now,
      updatedAt: now
    };
    groups.set(id, group);
    return group;
  }

  async getOrganization(orgId) {
    return this.organizations.get(orgId) || null;
  }

  async listOrganizations() {
    return Array.from(this.organizations.values());
  }

  async listOrganizationsForUser(user) {
    if (!user) {
      return [];
    }
    if (user.globalRole === 'SUPER_ADMIN') {
      return this.listOrganizations();
    }
    const results = [];
    for (const org of this.organizations.values()) {
      if (await this.isAdmin(org.id, user.id)) {
        results.push(org);
      }
    }
    return results;
  }

  async updateBranding(orgId, branding) {
    const organization = this.organizations.get(orgId);
    if (!organization) {
      const err = new Error('Organization not found');
      err.code = 'ORG_NOT_FOUND';
      throw err;
    }
    organization.branding = branding;
    organization.updatedAt = new Date();
    return organization;
  }
}

class OrganizationService {
  constructor({ idGenerator = randomUUID, store } = {}) {
    this.store = store ?? new InMemoryOrganizationStore({ idGenerator });
  }

  async createOrganization(input) {
    return await this.store.createOrganization(input);
  }

  async addAdmin(orgId, userId) {
    return await this.store.addAdmin(orgId, userId);
  }

  async isAdmin(orgId, userId) {
    return await this.store.isAdmin(orgId, userId);
  }

  async listAdmins(orgId) {
    return await this.store.listAdmins(orgId);
  }

  async addGroup(orgId, payload) {
    return await this.store.addGroup(orgId, payload);
  }

  async getOrganization(orgId) {
    return await this.store.getOrganization(orgId);
  }

  async listOrganizations() {
    return await this.store.listOrganizations();
  }

  async listOrganizationsForUser(user) {
    return await this.store.listOrganizationsForUser(user);
  }

  async updateBranding(orgId, branding) {
    return await this.store.updateBranding(orgId, branding);
  }
}

export { OrganizationService, InMemoryOrganizationStore };
