import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasCapability, injectOrgScope, requireAuth, requireRole } from '../src/middleware/auth.js';

function createResponse() {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  return res;
}

describe('requireAuth', () => {
  it('rejects missing session', () => {
    const req = { session: {} };
    const res = createResponse();
    let called = false;
    requireAuth(req, res, () => {
      called = true;
    });
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { message: 'Authentication required' });
  });

  it('allows authenticated requests', () => {
    const req = { session: { user: { id: 'u1', globalRole: 'STAFF', orgIds: [] } } };
    const res = createResponse();
    let called = false;
    requireAuth(req, res, () => {
      called = true;
    });
    assert.equal(called, true);
  });
});

describe('requireRole', () => {
  it('requires authentication', () => {
    const req = { session: {} };
    const res = createResponse();
    let called = false;
    requireRole('ADMIN')(req, res, () => {
      called = true;
    });
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
  });

  it('rejects insufficient role', () => {
    const req = { session: { user: { id: 'u1', globalRole: 'STAFF', orgIds: [] } } };
    const res = createResponse();
    let called = false;
    requireRole('ADMIN')(req, res, () => {
      called = true;
    });
    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { message: 'Forbidden for role STAFF' });
  });

  it('allows sufficient role', () => {
    const req = { session: { user: { id: 'u1', globalRole: 'ADMIN', orgIds: [] } } };
    const res = createResponse();
    let called = false;
    requireRole('ADMIN', 'SUPER_ADMIN')(req, res, () => {
      called = true;
    });
    assert.equal(called, true);
  });
});

describe('injectOrgScope', () => {
  it('populates orgIds', async () => {
    const req = { session: { user: { orgIds: ['org-1', 'org-2'] } } };
    const res = createResponse();
    let called = false;
    const setOrgContextCalls = [];
    const middleware = injectOrgScope({
      setOrgContext(orgIds, request) {
        setOrgContextCalls.push({ orgIds, request });
      }
    });
    await middleware(req, res, () => {
      called = true;
    });
    assert.deepEqual(req.orgIds, ['org-1', 'org-2']);
    assert.equal(called, true);
    assert.equal(setOrgContextCalls.length, 1);
    assert.deepEqual(setOrgContextCalls[0].orgIds, ['org-1', 'org-2']);
  });

  it('handles missing user session', async () => {
    const req = { session: {} };
    const res = createResponse();
    let called = false;
    const middleware = injectOrgScope();
    await middleware(req, res, () => {
      called = true;
    });
    assert.deepEqual(req.orgIds, []);
    assert.equal(called, true);
  });
});

describe('hasCapability', () => {
  it('returns true when capability present', () => {
    const req = { session: { user: { capabilities: ['manage:ai'] } } };
    assert.equal(hasCapability(req, 'manage:ai'), true);
  });

  it('returns false when capability missing', () => {
    const req = { session: { user: {} } };
    assert.equal(hasCapability(req, 'manage:ai'), false);
  });
});
