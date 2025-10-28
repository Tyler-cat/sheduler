import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OrganizationService } from '../src/services/organization-service.js';

function createService() {
  let counter = 0;
  const ids = ['org-1', 'group-1', 'group-2'];
  return new OrganizationService({
    idGenerator: () => {
      const id = ids[counter] || `id-${counter}`;
      counter += 1;
      return id;
    }
  });
}

describe('OrganizationService', () => {
  it('creates organizations with unique slugs', async () => {
    const service = createService();
    const org = await service.createOrganization({ name: 'Acme', slug: 'acme' });
    assert.equal(org.id, 'org-1');
    assert.equal(org.slug, 'acme');

    await assert.rejects(
      service.createOrganization({ name: 'Acme 2', slug: 'acme' }),
      /Organization slug already exists/
    );
  });

  it('tracks admins and groups per organization', async () => {
    const service = createService();
    const org = await service.createOrganization({ name: 'Acme', slug: 'acme' });
    const admin = await service.addAdmin(org.id, 'user-1');
    assert.deepEqual(admin, { orgId: org.id, userId: 'user-1' });
    assert.equal(await service.isAdmin(org.id, 'user-1'), true);

    const group = await service.addGroup(org.id, { name: 'Team A' });
    assert.equal(group.id, 'group-1');
    assert.equal(group.name, 'Team A');
    assert.equal(group.orgId, org.id);

    await assert.rejects(service.addGroup(org.id, { name: 'team a' }), /Group name already exists/);
  });

  it('lists organizations for admin users', async () => {
    const service = createService();
    const org = await service.createOrganization({ name: 'Acme', slug: 'acme' });
    await service.addAdmin(org.id, 'admin-1');

    const result = await service.listOrganizationsForUser({ id: 'admin-1', globalRole: 'ADMIN' });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, org.id);

    const superAdminResult = await service.listOrganizationsForUser({
      id: 's1',
      globalRole: 'SUPER_ADMIN'
    });
    assert.equal(superAdminResult.length, 1);
  });
});
