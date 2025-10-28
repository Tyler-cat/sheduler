import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaSchedulingStore } from '../src/stores/prisma-scheduling-store.js';
import { createMockPrisma } from './helpers/mock-prisma.js';

describe('PrismaSchedulingStore', () => {
  let prisma;
  let store;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaSchedulingStore({ prisma });
  });

  it('creates and retrieves scheduling suggestions', async () => {
    const createdAt = '2024-01-01T10:00:00.000Z';
    const suggestion = await store.createSuggestion({
      id: 'suggestion-1',
      organizationId: 'org-1',
      solver: 'heuristic',
      status: 'PENDING',
      createdBy: 'admin-1',
      createdAt,
      updatedAt: createdAt,
      committedAt: null,
      committedBy: null,
      queueJobId: 'job-1',
      inputSnapshot: { organizationId: 'org-1', userIds: ['u1'], rangeStart: createdAt, rangeEnd: createdAt },
      outputPlan: null,
      scoreBreakdown: null,
      errors: [],
      resultingEventIds: [],
      completedAt: null,
      metadata: null
    });
    assert.equal(suggestion.id, 'suggestion-1');
    assert.equal(suggestion.queueJobId, 'job-1');

    const fetched = await store.getSuggestion('suggestion-1');
    assert.equal(fetched.id, 'suggestion-1');
    assert.equal(fetched.organizationId, 'org-1');
    assert.equal(fetched.queueJobId, 'job-1');
    assert.deepEqual(fetched.errors, []);
  });

  it('updates suggestions and preserves arrays', async () => {
    await store.createSuggestion({
      id: 'suggestion-2',
      organizationId: 'org-1',
      solver: 'heuristic',
      status: 'PENDING',
      createdBy: 'admin-1',
      createdAt: '2024-01-02T09:00:00Z',
      updatedAt: '2024-01-02T09:00:00Z',
      committedAt: null,
      committedBy: null,
      queueJobId: null,
      inputSnapshot: { organizationId: 'org-1', userIds: ['u1'], rangeStart: '2024-01-02T09:00:00Z', rangeEnd: '2024-01-02T10:00:00Z' },
      outputPlan: null,
      scoreBreakdown: null,
      errors: [],
      resultingEventIds: [],
      completedAt: null,
      metadata: null
    });
    const updated = await store.updateSuggestion({
      id: 'suggestion-2',
      organizationId: 'org-1',
      solver: 'heuristic',
      status: 'READY',
      createdBy: 'admin-1',
      createdAt: '2024-01-02T09:00:00Z',
      updatedAt: '2024-01-02T09:05:00Z',
      committedAt: null,
      committedBy: null,
      queueJobId: null,
      inputSnapshot: { organizationId: 'org-1', userIds: ['u1'], rangeStart: '2024-01-02T09:00:00Z', rangeEnd: '2024-01-02T10:00:00Z' },
      outputPlan: { events: [{ title: 'Shift', start: '2024-01-02T09:00:00Z', end: '2024-01-02T10:00:00Z', assigneeIds: ['u1'] }] },
      scoreBreakdown: { feasibleWindows: 1 },
      errors: [],
      resultingEventIds: ['event-1'],
      completedAt: '2024-01-02T09:05:00Z',
      metadata: null
    });
    assert.equal(updated.status, 'READY');
    assert.equal(updated.outputPlan.events[0].title, 'Shift');
    assert.deepEqual(updated.resultingEventIds, ['event-1']);
  });

  it('lists suggestions for an organization ordered by createdAt desc', async () => {
    await store.createSuggestion({
      id: 'suggestion-older',
      organizationId: 'org-1',
      solver: 'heuristic',
      status: 'PENDING',
      createdBy: 'admin-1',
      createdAt: '2024-01-01T09:00:00Z',
      updatedAt: '2024-01-01T09:00:00Z',
      committedAt: null,
      committedBy: null,
      queueJobId: null,
      inputSnapshot: { organizationId: 'org-1', userIds: ['u1'], rangeStart: '2024-01-01T09:00:00Z', rangeEnd: '2024-01-01T10:00:00Z' },
      outputPlan: null,
      scoreBreakdown: null,
      errors: [],
      resultingEventIds: [],
      completedAt: null,
      metadata: null
    });
    await store.createSuggestion({
      id: 'suggestion-newer',
      organizationId: 'org-1',
      solver: 'heuristic',
      status: 'PENDING',
      createdBy: 'admin-1',
      createdAt: '2024-01-03T09:00:00Z',
      updatedAt: '2024-01-03T09:00:00Z',
      committedAt: null,
      committedBy: null,
      queueJobId: null,
      inputSnapshot: { organizationId: 'org-1', userIds: ['u1'], rangeStart: '2024-01-03T09:00:00Z', rangeEnd: '2024-01-03T10:00:00Z' },
      outputPlan: null,
      scoreBreakdown: null,
      errors: [],
      resultingEventIds: [],
      completedAt: null,
      metadata: null
    });
    await store.createSuggestion({
      id: 'suggestion-other-org',
      organizationId: 'org-2',
      solver: 'heuristic',
      status: 'PENDING',
      createdBy: 'admin-2',
      createdAt: '2024-01-04T09:00:00Z',
      updatedAt: '2024-01-04T09:00:00Z',
      committedAt: null,
      committedBy: null,
      queueJobId: null,
      inputSnapshot: { organizationId: 'org-2', userIds: ['u2'], rangeStart: '2024-01-04T09:00:00Z', rangeEnd: '2024-01-04T10:00:00Z' },
      outputPlan: null,
      scoreBreakdown: null,
      errors: [],
      resultingEventIds: [],
      completedAt: null,
      metadata: null
    });
    const suggestions = await store.listSuggestionsForOrg('org-1');
    assert.equal(suggestions.length, 2);
    assert.equal(suggestions[0].id, 'suggestion-newer');
    assert.equal(suggestions[1].id, 'suggestion-older');
  });
});
