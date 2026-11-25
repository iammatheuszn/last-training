'use strict';

const { UUID_PATTERN } = require('./nonce');

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const text = (value, min, max) =>
  typeof value === 'string' && value.trim().length >= min && value.length <= max;

const email = value => text(value, 5, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const uuid = value => UUID_PATTERN.test(value || '');

const oneOf = (value, allowed) => allowed.includes(value);

module.exports = { isObject, text, email, uuid, oneOf };
