function mapKnownError(error, handlers = {}) {
  if (!error) {
    return error;
  }
  if (error && typeof error === 'object' && typeof error.code === 'string') {
    const handler = handlers[error.code];
    if (handler) {
      return handler(error);
    }
  }
  return error;
}

class PrismaOrganizationStore {
  constructor({ prisma } = {}) {
    if (!prisma) {
      throw new Error('prisma client is required');
    }
    this.prisma = prisma;
  }

  async createOrganization({ name, slug, status = 'active', branding = null }) {
    if (!name || !slug) {
      throw new Error('name and slug are required');
    }
    try {
      return await this.prisma.organization.create({
        data: {
          name,
          slug,
          status,
          branding
        }
      });
    } catch (error) {
      const mapped = mapKnownError(error, {
        P2002: () => {
          const err = new Error('Organization slug already exists');
          err.code = 'ORG_DUPLICATE_SLUG';
          return err;
        }
      });
      throw mapped;
    }
  }

  async addAdmin(orgId, userId) {
    if (!userId) {
      throw new Error('userId is required');
    }
    const organization = await this.getOrganization(orgId);
    if (!organization) {
      const err = new Error('Organization not found');
      err.code = 'ORG_NOT_FOUND';
      throw err;
    }
    try {
      await this.prisma.organizationAdmin.upsert({
        where: { userId_orgId: { userId, orgId } },
        create: { userId, orgId },
        update: {}
      });
      return { orgId, userId };
    } catch (error) {
      const mapped = mapKnownError(error, {
        P2003: (err) => {
          const field = String(err?.meta?.field_name || '').toLowerCase();
          const mappedError = new Error(
            field.includes('user') ? 'User not found' : 'Organization not found'
          );
          mappedError.code = field.includes('user') ? 'USER_NOT_FOUND' : 'ORG_NOT_FOUND';
          return mappedError;
        }
      });
      throw mapped;
    }
  }

  async isAdmin(orgId, userId) {
    if (!userId) {
      return false;
    }
    const record = await this.prisma.organizationAdmin.findUnique({
      where: { userId_orgId: { userId, orgId } }
    });
    return Boolean(record);
  }

  async listAdmins(orgId) {
    const rows = await this.prisma.organizationAdmin.findMany({
      where: { orgId }
    });
    return rows.map((row) => row.userId);
  }

  async addGroup(orgId, { name }) {
    if (!name) {
      throw new Error('name is required');
    }
    const organization = await this.getOrganization(orgId);
    if (!organization) {
      const err = new Error('Organization not found');
      err.code = 'ORG_NOT_FOUND';
      throw err;
    }
    try {
      return await this.prisma.group.create({
        data: {
          orgId,
          name
        }
      });
    } catch (error) {
      const mapped = mapKnownError(error, {
        P2002: () => {
          const err = new Error('Group name already exists in organization');
          err.code = 'GROUP_DUPLICATE_NAME';
          return err;
        }
      });
      throw mapped;
    }
  }

  async getOrganization(orgId) {
    if (!orgId) {
      return null;
    }
    return await this.prisma.organization.findUnique({
      where: { id: orgId }
    });
  }

  async listOrganizations() {
    return await this.prisma.organization.findMany({
      orderBy: { createdAt: 'asc' }
    });
  }

  async listOrganizationsForUser(user) {
    if (!user) {
      return [];
    }
    if (user.globalRole === 'SUPER_ADMIN') {
      return await this.listOrganizations();
    }
    if (user.globalRole === 'ADMIN') {
      const assignments = await this.prisma.organizationAdmin.findMany({
        where: { userId: user.id },
        include: { org: true }
      });
      return assignments.map((assignment) => assignment.org).filter(Boolean);
    }
    if (Array.isArray(user.orgIds) && user.orgIds.length > 0) {
      return await this.prisma.organization.findMany({
        where: { id: { in: user.orgIds } }
      });
    }
    return [];
  }

  async updateBranding(orgId, branding) {
    const organization = await this.getOrganization(orgId);
    if (!organization) {
      const err = new Error('Organization not found');
      err.code = 'ORG_NOT_FOUND';
      throw err;
    }
    return await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        branding,
        updatedAt: new Date()
      }
    });
  }
}

export { PrismaOrganizationStore };
