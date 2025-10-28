import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationService } from '../src/services/notification-service.js';

describe('NotificationService', () => {
  it('stores notifications by organization and recipient and tracks read status', async () => {
    const service = new NotificationService({
      idGenerator: (() => {
        let i = 0;
        return () => `notif-${++i}`;
      })(),
      clock: () => new Date('2024-02-01T00:00:00.000Z')
    });

    const created = await service.createNotification({
      organizationId: 'org-1',
      recipientIds: ['admin-1', 'admin-2', 'admin-1'],
      subject: 'Action required',
      message: 'Please review the pending request',
      metadata: { source: 'tool' }
    });

    assert.equal(created.id, 'notif-1');
    assert.deepEqual(created.recipientIds, ['admin-1', 'admin-2']);
    assert.deepEqual(created.readReceipts, {});

    const byOrg = await service.listByOrganization('org-1');
    assert.equal(byOrg.length, 1);
    assert.equal(byOrg[0].subject, 'Action required');
    assert.deepEqual(byOrg[0].readReceipts, {});

    const forRecipient = await service.listForRecipient('admin-1');
    assert.equal(forRecipient.length, 1);
    assert.equal(forRecipient[0].id, 'notif-1');
    assert.deepEqual(forRecipient[0].metadata, { source: 'tool' });
    assert.equal(forRecipient[0].readAt, null);

    const marked = await service.markRead({ notificationId: 'notif-1', recipientId: 'admin-1' });
    assert.equal(marked.readAt, '2024-02-01T00:00:00.000Z');

    const refreshedOrg = await service.listByOrganization('org-1');
    assert.deepEqual(refreshedOrg[0].readReceipts, { 'admin-1': '2024-02-01T00:00:00.000Z' });

    const refreshedRecipient = await service.listForRecipient('admin-1');
    assert.equal(refreshedRecipient[0].readAt, '2024-02-01T00:00:00.000Z');
  });
});
