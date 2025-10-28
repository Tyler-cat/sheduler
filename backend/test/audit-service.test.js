import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuditService } from '../src/services/audit-service.js';
import { MetricsService } from '../src/services/metrics-service.js';

describe('AuditService', () => {
  it('records entries with masked metadata and increments metrics', () => {
    const metrics = new MetricsService();
    const audit = new AuditService({
      clock: () => new Date('2024-05-01T00:00:00.000Z'),
      idGenerator: () => 'audit-1',
      metricsService: metrics
    });

    const entry = audit.record({
      actorId: 'user-1',
      action: 'event.create',
      subjectType: 'event',
      subjectId: 'event-1',
      organizationId: 'org-1',
      metadata: { title: 'Super Secret Shift', contactEmail: 'alice@example.com' },
      sensitiveFields: ['title']
    });

    assert.equal(entry.id, 'audit-1');
    assert.equal(entry.actorId, 'user-1');
    assert.equal(entry.organizationId, 'org-1');
    assert.equal(entry.metadata.title, 'Su***t');
    assert.equal(entry.metadata.contactEmail, 'al***m');

    const snapshot = metrics.getSnapshot();
    const counter = snapshot.counters.find((item) => item.name === 'audit_entries_total');
    assert.ok(counter);
    assert.equal(counter.value, 1);
    assert.equal(counter.labels.action, 'event.create');
  });
});
