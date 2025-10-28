import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { OrganizationService } from '../src/services/organization-service.js';

function encodeSession(session) {
  return Buffer.from(JSON.stringify(session)).toString('base64url');
}

function createSessionParser() {
  return async (req) => {
    const raw = req.headers['x-test-session'];
    if (!raw) {
      return {};
    }
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  };
}

async function startApp(app) {
  return new Promise((resolve) => {
    const server = app.listen(() => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function stopApp(app) {
  return new Promise((resolve) => {
    app.close(() => resolve());
  });
}

describe('organization API', () => {
  let service;
  let app;

  beforeEach(() => {
    let counter = 0;
    const ids = ['org-1', 'group-1', 'group-2'];
    service = new OrganizationService({
      idGenerator: () => {
        const id = ids[counter] || `id-${counter}`;
        counter += 1;
        return id;
      }
    });
    app = createApp({
      port: 0,
      services: { organizationService: service },
      sessionParser: createSessionParser()
    });
  });

  it('requires authentication for organization creation', async () => {
    const { port } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/organizations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Acme', slug: 'acme' })
      });
      assert.equal(response.status, 401);
    } finally {
      await stopApp(app);
    }
  });

  it('allows super admin to create organizations and seed admins', async () => {
    const { port } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/organizations`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'super-1', globalRole: 'SUPER_ADMIN' } })
        },
        body: JSON.stringify({ name: 'Acme', slug: 'acme', initialAdminIds: ['admin-1'] })
      });
      assert.equal(response.status, 201);
      const payload = await response.json();
      assert.equal(payload.organization.id, 'org-1');
      assert.deepEqual(payload.assignedAdminIds, ['admin-1']);

      const listResponse = await fetch(`http://127.0.0.1:${port}/api/organizations?mine=true`, {
        headers: {
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN' } })
        }
      });
      assert.equal(listResponse.status, 200);
      const listPayload = await listResponse.json();
      assert.equal(listPayload.organizations.length, 1);
      assert.equal(listPayload.organizations[0].id, 'org-1');
    } finally {
      await stopApp(app);
    }
  });

  it('prevents admins without scope from modifying other organizations', async () => {
    await service.createOrganization({ name: 'Acme', slug: 'acme' });
    const { port } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/organizations/org-1/groups`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'admin-2', globalRole: 'ADMIN' } })
        },
        body: JSON.stringify({ name: 'Team A' })
      });
      assert.equal(response.status, 403);
    } finally {
      await stopApp(app);
    }
  });

  it('allows organization admins to add groups and administrators', async () => {
    const org = await service.createOrganization({ name: 'Acme', slug: 'acme' });
    await service.addAdmin(org.id, 'admin-1');
    const { port } = await startApp(app);
    try {
      const groupResponse = await fetch(`http://127.0.0.1:${port}/api/organizations/${org.id}/groups`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN' } })
        },
        body: JSON.stringify({ name: 'Team A' })
      });
      assert.equal(groupResponse.status, 201);
      const groupPayload = await groupResponse.json();
      assert.equal(groupPayload.group.id, 'group-1');

      const adminResponse = await fetch(`http://127.0.0.1:${port}/api/organizations/${org.id}/admins`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN' } })
        },
        body: JSON.stringify({ userId: 'admin-2' })
      });
      assert.equal(adminResponse.status, 200);
      const assignment = await adminResponse.json();
      assert.deepEqual(assignment.assignment, { orgId: org.id, userId: 'admin-2' });

      const listResponse = await fetch(`http://127.0.0.1:${port}/api/organizations?mine=true`, {
        headers: {
          'x-test-session': encodeSession({ user: { id: 'admin-2', globalRole: 'ADMIN' } })
        }
      });
      const listPayload = await listResponse.json();
      assert.equal(listPayload.organizations.length, 1);
    } finally {
      await stopApp(app);
    }
  });
});
