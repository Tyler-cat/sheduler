import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MetricsService } from '../src/services/metrics-service.js';

describe('MetricsService', () => {
  it('aggregates counters and summaries and renders prometheus output', () => {
    const metrics = new MetricsService();
    metrics.incrementCounter('test_counter_total', { label: 'one' }, 2, {
      help: 'Example counter'
    });
    metrics.incrementCounter('test_counter_total', { label: 'one' }, 3);
    metrics.observeSummary('test_duration_ms', { path: '/foo' }, 10, {
      help: 'Example summary'
    });
    metrics.observeSummary('test_duration_ms', { path: '/foo' }, 30);

    const snapshot = metrics.getSnapshot();
    const counter = snapshot.counters.find((item) => item.name === 'test_counter_total');
    assert.ok(counter);
    assert.equal(counter.value, 5);

    const summary = snapshot.summaries.find((item) => item.name === 'test_duration_ms');
    assert.ok(summary);
    assert.equal(summary.count, 2);
    assert.equal(summary.sum, 40);
    assert.equal(summary.min, 10);
    assert.equal(summary.max, 30);

    const text = metrics.toPrometheus();
    assert.match(text, /# HELP test_counter_total Example counter/);
    assert.match(text, /test_counter_total\{label="one"} 5/);
    assert.match(text, /test_duration_ms_sum\{path="\/foo"} 40/);
    assert.match(text, /test_duration_ms_count\{path="\/foo"} 2/);
  });
});
