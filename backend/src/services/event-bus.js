import { EventEmitter } from 'node:events';

class EventBus {
  constructor({ clock = () => new Date(), historyLimit = 500 } = {}) {
    this.clock = clock;
    this.historyLimit = historyLimit;
    this.sequence = 0;
    this.listeners = new Map();
    this.history = [];
    this.emitter = new EventEmitter({ captureRejections: true });
  }

  subscribe(channel, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('handler must be a function');
    }
    const listener = (message) => handler(message);
    this.emitter.on(channel, listener);
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel).add(listener);
    return () => {
      this.emitter.off(channel, listener);
      const channelListeners = this.listeners.get(channel);
      if (channelListeners) {
        channelListeners.delete(listener);
        if (!channelListeners.size) {
          this.listeners.delete(channel);
        }
      }
    };
  }

  publish(channel, { type, payload, metadata } = {}) {
    if (!channel || typeof channel !== 'string') {
      throw new TypeError('channel must be a string');
    }
    const envelope = {
      sequence: ++this.sequence,
      channel,
      type: type || 'event',
      payload: payload ?? {},
      metadata: metadata ?? {},
      timestamp: this.clock().toISOString()
    };
    this.history.push(envelope);
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit);
    }
    this.emitter.emit(channel, envelope);
    return envelope;
  }

  historySince(channel, sinceSequence = 0) {
    return this.history.filter((item) => item.channel === channel && item.sequence > sinceSequence);
  }

  activeChannels() {
    return Array.from(this.listeners.keys());
  }
}

export { EventBus };
