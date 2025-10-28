import { performance } from 'node:perf_hooks';

function cloneLabels(labels = {}) {
  return Object.fromEntries(Object.entries(labels).map(([key, value]) => [key, String(value)]));
}

class MetricsService {
  constructor() {
    this.counters = new Map();
    this.summaries = new Map();
    this.gauges = new Map();
    this.metadata = new Map();
  }

  #key(name, labels) {
    const normalized = cloneLabels(labels);
    const parts = Object.keys(normalized)
      .sort()
      .map((key) => `${key}:${normalized[key]}`);
    return `${name}|${parts.join('|')}`;
  }

  #ensureMetadata(name, type, help) {
    if (!this.metadata.has(name)) {
      this.metadata.set(name, { type, help: help || `Auto generated metric for ${name}` });
      return;
    }
    const existing = this.metadata.get(name);
    if (existing.type !== type) {
      throw new Error(`Metric ${name} already registered with type ${existing.type}`);
    }
    if (help && existing.help === `Auto generated metric for ${name}`) {
      existing.help = help;
    }
  }

  incrementCounter(name, labels = {}, value = 1, options = {}) {
    const { help } = options;
    this.#ensureMetadata(name, 'counter', help);
    const key = this.#key(name, labels);
    const entry = this.counters.get(key) || { name, labels: cloneLabels(labels), value: 0 };
    entry.value += value;
    this.counters.set(key, entry);
  }

  adjustGauge(name, labels = {}, delta, options = {}) {
    if (typeof delta !== 'number' || Number.isNaN(delta)) {
      return;
    }
    const { help } = options;
    this.#ensureMetadata(name, 'gauge', help);
    const key = this.#key(name, labels);
    const entry = this.gauges.get(key) || { name, labels: cloneLabels(labels), value: 0 };
    entry.value += delta;
    this.gauges.set(key, entry);
  }

  setGauge(name, labels = {}, value, options = {}) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return;
    }
    const { help } = options;
    this.#ensureMetadata(name, 'gauge', help);
    const key = this.#key(name, labels);
    const entry = this.gauges.get(key) || { name, labels: cloneLabels(labels), value: 0 };
    entry.value = value;
    this.gauges.set(key, entry);
  }

  observeSummary(name, labels = {}, value, options = {}) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return;
    }
    const { help } = options;
    this.#ensureMetadata(name, 'summary', help);
    const key = this.#key(name, labels);
    const entry =
      this.summaries.get(key) || {
        name,
        labels: cloneLabels(labels),
        count: 0,
        sum: 0,
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY
      };
    entry.count += 1;
    entry.sum += value;
    entry.min = Math.min(entry.min, value);
    entry.max = Math.max(entry.max, value);
    this.summaries.set(key, entry);
  }

  recordHttpRequest({ method, path, statusCode, durationMs }) {
    const labels = {
      method: method || 'UNKNOWN',
      path: path || 'unknown',
      status: String(statusCode || 0)
    };
    this.incrementCounter('http_requests_total', labels, 1, {
      help: 'Total number of HTTP requests received'
    });
    this.observeSummary('http_request_duration_ms', labels, durationMs, {
      help: 'HTTP request duration in milliseconds'
    });
    if (Number(statusCode) >= 500) {
      this.incrementCounter(
        'http_5xx_total',
        { method: labels.method, path: labels.path },
        1,
        { help: 'Number of HTTP responses returning status 5xx grouped by method and path' }
      );
    }
  }

  startTimer() {
    const start = performance.now();
    return () => performance.now() - start;
  }

  recordDbQuery({
    model = 'unknown',
    operation = 'query',
    durationMs = 0,
    success = true,
    thresholdMs = 200
  } = {}) {
    const labels = {
      model,
      operation,
      status: success ? 'success' : 'error'
    };
    this.incrementCounter(
      'db_queries_total',
      labels,
      1,
      { help: 'Number of database operations grouped by model, operation and status' }
    );
    if (typeof durationMs === 'number' && !Number.isNaN(durationMs)) {
      this.observeSummary('db_query_duration_ms', labels, durationMs, {
        help: 'Database query execution duration in milliseconds'
      });
      if (durationMs >= thresholdMs) {
        this.incrementCounter(
          'db_slow_queries_total',
          labels,
          1,
          { help: 'Number of database queries exceeding the configured slow-query threshold' }
        );
      }
    }
  }

  getSnapshot() {
    return {
      counters: Array.from(this.counters.values()).map((entry) => ({
        name: entry.name,
        labels: cloneLabels(entry.labels),
        value: entry.value
      })),
      gauges: Array.from(this.gauges.values()).map((entry) => ({
        name: entry.name,
        labels: cloneLabels(entry.labels),
        value: entry.value
      })),
      summaries: Array.from(this.summaries.values()).map((entry) => ({
        name: entry.name,
        labels: cloneLabels(entry.labels),
        count: entry.count,
        sum: entry.sum,
        min: entry.min === Number.POSITIVE_INFINITY ? 0 : entry.min,
        max: entry.max === Number.NEGATIVE_INFINITY ? 0 : entry.max
      }))
    };
  }

  #formatLabels(labels) {
    const keys = Object.keys(labels);
    if (!keys.length) {
      return '';
    }
    const formatted = keys
      .sort()
      .map((key) => `${key}="${labels[key].replace(/"/g, '\\"')}"`)
      .join(',');
    return `{${formatted}}`;
  }

  toPrometheus() {
    const lines = [];
    const printedHeaders = new Set();

    for (const entry of this.counters.values()) {
      if (!printedHeaders.has(entry.name)) {
        const meta = this.metadata.get(entry.name) || { help: `Auto generated metric for ${entry.name}` };
        lines.push(`# HELP ${entry.name} ${meta.help}`);
        lines.push(`# TYPE ${entry.name} counter`);
        printedHeaders.add(entry.name);
      }
      lines.push(`${entry.name}${this.#formatLabels(entry.labels)} ${entry.value}`);
    }

    for (const entry of this.gauges.values()) {
      if (!printedHeaders.has(entry.name)) {
        const meta = this.metadata.get(entry.name) || { help: `Auto generated metric for ${entry.name}` };
        lines.push(`# HELP ${entry.name} ${meta.help}`);
        lines.push(`# TYPE ${entry.name} gauge`);
        printedHeaders.add(entry.name);
      }
      lines.push(`${entry.name}${this.#formatLabels(entry.labels)} ${entry.value}`);
    }

    for (const entry of this.summaries.values()) {
      if (!printedHeaders.has(entry.name)) {
        const meta = this.metadata.get(entry.name) || { help: `Auto generated metric for ${entry.name}` };
        lines.push(`# HELP ${entry.name} ${meta.help}`);
        lines.push(`# TYPE ${entry.name} summary`);
        printedHeaders.add(entry.name);
      }
      const labels = this.#formatLabels(entry.labels);
      lines.push(`${entry.name}_sum${labels} ${entry.sum}`);
      lines.push(`${entry.name}_count${labels} ${entry.count}`);
      lines.push(`${entry.name}_min${labels} ${entry.min === Number.POSITIVE_INFINITY ? 0 : entry.min}`);
      lines.push(`${entry.name}_max${labels} ${entry.max === Number.NEGATIVE_INFINITY ? 0 : entry.max}`);
    }

    return lines.join('\n');
  }
}

export { MetricsService };
