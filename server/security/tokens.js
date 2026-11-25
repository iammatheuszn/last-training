'use strict';

const crypto = require('node:crypto');

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

function issue(payload, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      iat: now,
      exp: now + ttlSeconds,
      jti: crypto.randomUUID()
    })
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${HEADER}.${body}`).digest('base64url');
  return { token: `${HEADER}.${body}.${signature}`, expiresAt: (now + ttlSeconds) * 1000 };
}

function verify(token, secret, expectedType) {
  if (typeof token !== 'string' || token.length > 8192) {
    const error = new Error('Token inválido.');
    error.code = 'TOKEN_INVALID';
    error.status = 401;
    throw error;
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HEADER) {
    const error = new Error('Token inválido.');
    error.code = 'TOKEN_INVALID';
    error.status = 401;
    throw error;
  }

  const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  let given;
  try {
    given = Buffer.from(parts[2], 'base64url');
  } catch {
    given = Buffer.alloc(0);
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    const error = new Error('Assinatura do token inválida.');
    error.code = 'TOKEN_INVALID';
    error.status = 401;
    throw error;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    const error = new Error('Token inválido.');
    error.code = 'TOKEN_INVALID';
    error.status = 401;
    throw error;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    const error = new Error('Sessão expirada.');
    error.code = 'TOKEN_EXPIRED';
    error.status = 401;
    throw error;
  }
  if ((expectedType && payload.typ !== expectedType) || typeof payload.sub !== 'string') {
    const error = new Error('Token inválido.');
    error.code = 'TOKEN_INVALID';
    error.status = 401;
    throw error;
  }
  return payload;
}

function refreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

module.exports = { issue, verify, refreshToken, fingerprint };
