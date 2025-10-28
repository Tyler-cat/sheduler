import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OrganizationService } from '../src/services/organization-service.js';
import { EventService } from '../src/services/event-service.js';
import { NotificationService } from '../src/services/notification-service.js';
import { ToolService } from '../src/services/tool-service.js';

describe('ToolService', () => {
  function createServices() {
    let eventCounter = 0;
    const organizationService = new OrganizationService({
      idGenerator: () => 'org-1'
    });
    const eventService = new EventService({
      idGenerator: () => `event-${++eventCounter}`,
      clock: () => new Date('2024-02-01T00:00:00.000Z')
    });
    const notificationService = new NotificationService({
      idGenerator: () => 'notif-1',
      clock: () => new Date('2024-02-01T00:00:00.000Z')
    });
    return { organizationService, eventService, notificationService };
  }

  it('sends notifications to organization admins', async () => {
    const { organizationService, eventService, notificationService } = createServices();
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    await organizationService.addAdmin(org.id, 'admin-1');
    await organizationService.addAdmin(org.id, 'admin-2');
    const toolService = new ToolService({ organizationService, eventService, notificationService });

    const result = await toolService.execute(
      'notify_admin',
      { organizationId: org.id, message: 'New request' },
      { actorId: 'staff-1' }
    );

    assert.equal(result.status, 'DELIVERED');
    assert.deepEqual(result.recipients.sort(), ['admin-1', 'admin-2']);
    const notifications = await notificationService.listByOrganization(org.id);
    assert.equal(notifications.length, 1);
  });

  it('creates personal schedule events for the actor', async () => {
    const { organizationService, eventService, notificationService } = createServices();
    const org = await organizationService.createOrganization({ name: 'Acme', slug: 'acme' });
    const toolService = new ToolService({ organizationService, eventService, notificationService });

    const result = await toolService.execute(
      'update_personal_schedule',
      {
        organizationId: org.id,
        title: 'Study Session',
        start: '2024-02-02T10:00:00.000Z',
        end: '2024-02-02T11:00:00.000Z'
      },
      { actorId: 'staff-1' }
    );

    assert.equal(result.event.id, 'event-1');
    assert.deepEqual(result.event.assigneeIds, ['staff-1']);
  });

  it('throws for unsupported tools', async () => {
    const { organizationService, eventService, notificationService } = createServices();
    const toolService = new ToolService({ organizationService, eventService, notificationService });
    await assert.rejects(
      toolService.execute('unknown_tool', {}, { actorId: 'user-1' }),
      /Unsupported tool/
    );
  });
});
