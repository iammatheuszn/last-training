'use strict';

const { randomUUID } = require('node:crypto');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class NonceGuard {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.seen = new Map();
  }

  check(value, now = Date.now()) {
    if (!UUID_PATTERN.test(value || '')) return false;
    if (this.seen.has(value) && this.seen.get(value) > now) return false;
    this.seen.set(value, now + this.ttlMs);
    if (this.seen.size > 10000) this.prune(now);
    return true;
  }

  prune(now = Date.now()) {
    for (const [value, expires] of this.seen) {
      if (expires <= now) this.seen.delete(value);
    }
  }
}

module.exports = { NonceGuard, randomUUID, UUID_PATTERN };
