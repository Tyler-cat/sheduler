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

describe('organization branding API', () => {
  let organizationService;
  let app;
  let org;

  beforeEach(async () => {
    let counter = 0;
    const ids = ['org-1'];
    organizationService = new OrganizationService({
      idGenerator: () => {
        const id = ids[counter] || `id-${counter}`;
        counter += 1;
        return id;
      }
    });
    org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');
    app = createApp({
      port: 0,
      services: { organizationService },
      sessionParser: createSessionParser()
    });
  });

  it('requires authentication to access branding', async () => {
    const { port, server } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/organizations/${org.id}/branding`);
      assert.equal(response.status, 401);
    } finally {
      await stopApp(server);
    }
  });

  it('allows scoped users to view branding defaults', async () => {
    const { port, server } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/organizations/${org.id}/branding`, {
        headers: {
          'x-test-session': encodeSession({ user: { id: 'staff-1', globalRole: 'STAFF', orgIds: [org.id] } })
        }
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.branding.primaryColor, '#2563eb');
    } finally {
      await stopApp(server);
    }
  });

  it('allows admins to update branding', async () => {
    const { port, server } = await startApp(app);
    try {
      const updateResponse = await fetch(`http://127.0.0.1:${port}/api/organizations/${org.id}/branding`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN' } })
        },
        body: JSON.stringify({
          primaryColor: '#111111',
          tokens: { logo_text: 'Acme Schedules' }
        })
      });
      assert.equal(updateResponse.status, 200);
      const updated = await updateResponse.json();
      assert.equal(updated.branding.primaryColor, '#111111');
      assert.equal(updated.branding.tokens.logo_text, 'Acme Schedules');

      const getResponse = await fetch(`http://127.0.0.1:${port}/api/organizations/${org.id}/branding`, {
        headers: {
          'x-test-session': encodeSession({ user: { id: 'staff-2', globalRole: 'STAFF', orgIds: [org.id] } })
        }
      });
      const payload = await getResponse.json();
      assert.equal(payload.branding.tokens.logo_text, 'Acme Schedules');
      assert.ok(payload.branding.updatedAt);
    } finally {
      await stopApp(server);
    }
  });

  it('rejects invalid color payloads', async () => {
    const { port, server } = await startApp(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/organizations/${org.id}/branding`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-test-session': encodeSession({ user: { id: 'admin-1', globalRole: 'ADMIN' } })
        },
        body: JSON.stringify({ primaryColor: 'blue' })
      });
      assert.equal(response.status, 400);
      const payload = await response.json();
      assert.equal(payload.code, 'BRANDING_INVALID_COLOR');
    } finally {
      await stopApp(server);
    }
  });
});
