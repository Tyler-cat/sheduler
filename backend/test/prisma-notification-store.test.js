import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaNotificationStore } from '../src/stores/prisma-notification-store.js';
import { createMockPrisma } from './helpers/mock-prisma.js';

describe('PrismaNotificationStore', () => {
  let prisma;
  let store;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaNotificationStore({ prisma });
  });

  it('creates notifications and lists by organization and recipient', async () => {
    const created = await store.create({
      id: 'notif-1',
      organizationId: 'org-1',
      subject: 'Action required',
      message: 'Queue backlog exceeds threshold',
      category: 'alert',
      metadata: { severity: 'high' },
      createdBy: 'admin-1',
      createdAt: '2024-08-01T08:00:00.000Z',
      recipients: [
        { recipientId: 'admin-1', readAt: null, createdAt: '2024-08-01T08:00:00.000Z' },
        { recipientId: 'staff-1', readAt: null, createdAt: '2024-08-01T08:00:00.000Z' }
      ]
    });

    assert.equal(created.id, 'notif-1');
    assert.equal(created.organizationId, 'org-1');
    assert.equal(created.recipients.length, 2);

    const orgList = await store.listByOrganization('org-1');
    assert.equal(orgList.length, 1);
    assert.equal(orgList[0].message, 'Queue backlog exceeds threshold');

    const recipientList = await store.listForRecipient('staff-1');
    assert.equal(recipientList.length, 1);
    assert.equal(recipientList[0].id, 'notif-1');
  });

  it('updates read receipts and maps get lookups', async () => {
    await store.create({
      id: 'notif-2',
      organizationId: 'org-2',
      message: 'Check schedule',
      recipients: [{ recipientId: 'staff-2', readAt: null, createdAt: '2024-08-01T08:00:00.000Z' }]
    });

    const before = await store.get('notif-2');
    assert.equal(before.recipients[0].readAt, null);

    const updated = await store.markRead('notif-2', 'staff-2', '2024-08-01T09:00:00.000Z');
    assert.equal(updated.recipients[0].readAt, '2024-08-01T09:00:00.000Z');

    const notFound = await store.markRead('notif-2', 'unknown', '2024-08-01T10:00:00.000Z');
    assert.equal(notFound, null);

    const missing = await store.markRead('missing', 'staff-2', '2024-08-01T10:00:00.000Z');
    assert.equal(missing, null);
  });
});
