'use strict';

class RateLimiter {
  constructor() {
    this.buckets = new Map();
  }

  check(key, limit, windowMs, now = Date.now()) {
    const recent = (this.buckets.get(key) || []).filter(timestamp => now - timestamp < windowMs);
    this.buckets.set(key, recent);
    if (recent.length >= limit) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000))
      };
    }
    return { allowed: true, retryAfter: 0 };
  }

  hit(key, limit, windowMs, now = Date.now()) {
    const verdict = this.check(key, limit, windowMs, now);
    if (!verdict.allowed) return verdict;
    this.buckets.get(key).push(now);
    return { allowed: true, retryAfter: 0 };
  }

  clear(key) {
    this.buckets.delete(key);
  }

  prune(windowMs, now = Date.now()) {
    for (const [key, entries] of this.buckets) {
      const recent = entries.filter(timestamp => now - timestamp < windowMs);
      if (recent.length) this.buckets.set(key, recent);
      else this.buckets.delete(key);
    }
  }
}

module.exports = { RateLimiter };
