'use strict';

const crypto = require('node:crypto');
const tokens = require('../security/tokens');
const { uuid, text, isObject } = require('../security/validate');
const { record } = require('./audit');
const { registerOrTouch } = require('./devices');
const licenses = require('./license');

function fail(code, status, message, retryAfter = 0) {
  const error = new Error(message || 'Falha na autenticação.');
  error.code = code;
  error.status = status;
  error.retryAfter = retryAfter;
  return error;
}

function accountByEmail(db, identity) {
  return db.prepare(
    'SELECT id, email, display, password_hash, status FROM accounts WHERE email = ? COLLATE NOCASE OR display = ? COLLATE NOCASE'
  ).get(identity, identity);
}

function assertAccountActive(account) {
  if (!account) throw fail('INVALID_CREDENTIALS', 401);
  if (account.status !== 'active') throw fail('ACCOUNT_BLOCKED', 403);
}

function createSession(db, config, accountId, deviceId, now) {
  const refresh = tokens.refreshToken();
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO sessions (id, account_id, device_id, refresh_hash, expires_at, revoked, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
  ).run(
    id,
    accountId,
    deviceId,
    tokens.fingerprint(refresh),
    now + config.refreshTtlDays * 86400000,
    new Date(now).toISOString()
  );
  return { id, refresh };
}

function publicAccount(account) {
  return { id: account.id, display: account.display, email: account.email };
}

function withLicense(db, account, extra = {}) {
  return {
    ...extra,
    account: publicAccount(account),
    license: licenses.summary(db, account.id),
    serverTime: Date.now()
  };
}

function createAuthService({ db, config, limiter, nonces }) {
  function noteFailure(identity, context) {
    const key = `login:${context.ip}:${identity.toLowerCase()}`;
    const verdict = limiter.hit(key, config.loginMaxFailures, config.loginWindowMs);
    record(db, 'login_failed', { ip: context.ip });
    return verdict;
  }

  return {
    login(body, context) {
      if (!isObject(body) || !text(body.identity, 3, 254) || !text(body.password, 1, 256)) {
        throw fail('INVALID_INPUT', 400);
      }
      if (!isObject(body.device) || !uuid(body.device.id) || !text(body.device.name, 1, 80)) {
        throw fail('DEVICE_INVALID', 400);
      }
      const device = {
        id: body.device.id,
        name: body.device.name.trim(),
        hwid: body.device.hwid === undefined ? body.device.id : body.device.hwid
      };
      if (!text(device.hwid, 1, 128)) throw fail('DEVICE_INVALID', 400);

      const global = limiter.hit(`global:${context.ip}`, config.globalMaxPerMinute, 60000);
      if (!global.allowed) throw fail('RATE_LIMITED', 429, 'Muitas requisições. Tente novamente em instantes.', global.retryAfter);

      const identity = body.identity.trim();
      const failureKey = `login:${context.ip}:${identity.toLowerCase()}`;
      const locked = limiter.check(failureKey, config.loginMaxFailures, config.loginWindowMs);
      if (!locked.allowed) {
        throw fail('RATE_LIMITED', 429, 'Muitas tentativas de acesso. Aguarde antes de tentar de novo.', locked.retryAfter);
      }

      const account = accountByEmail(db, identity);
      if (!account) {
        const verdict = noteFailure(identity, context);
        throw fail('INVALID_CREDENTIALS', 401, undefined, verdict.retryAfter);
      }
      if (!require('../security/passwords').verify(body.password, account.password_hash)) {
        const verdict = noteFailure(identity, context);
        throw fail('INVALID_CREDENTIALS', 401, undefined, verdict.retryAfter);
      }
      assertAccountActive(account);

      registerOrTouch(db, account.id, device, config.maxDevices, context);
      licenses.assertActive(licenses.summary(db, account.id));

      const session = createSession(db, config, account.id, body.device.id, Date.now());
      const issued = tokens.issue(
        { sub: account.id, typ: 'access', device: device.id, sid: session.id },
        config.jwtSecret,
        config.accessTtlSeconds
      );
      limiter.clear(failureKey);
      record(db, 'login_success', { accountId: account.id, detail: body.device.id, ip: context.ip });

      return withLicense(db, account, {
        token: issued.token,
        refreshToken: session.refresh,
        expiresAt: issued.expiresAt
      });
    },

    refresh(body, context) {
      if (!isObject(body) || !text(body.refreshToken, 20, 512)) throw fail('INVALID_INPUT', 400);
      const global = limiter.hit(`global:${context.ip}`, config.globalMaxPerMinute, 60000);
      if (!global.allowed) throw fail('RATE_LIMITED', 429, 'Muitas requisições.', global.retryAfter);

      const hash = tokens.fingerprint(body.refreshToken);
      const session = db.prepare('SELECT * FROM sessions WHERE refresh_hash = ?').get(hash);
      if (!session) throw fail('TOKEN_INVALID', 401);

      const device = db.prepare('SELECT revoked FROM devices WHERE id = ?').get(session.device_id);
      if (!device || device.revoked) throw fail('DEVICE_REVOKED', 403);

      if (session.revoked) {
        db.prepare('UPDATE sessions SET revoked = 1 WHERE account_id = ?').run(session.account_id);
        record(db, 'replay_detected', { accountId: session.account_id, ip: context.ip });
        throw fail('SESSION_REVOKED', 401, 'Sessão revogada. Entre novamente.');
      }
      if (session.expires_at <= Date.now()) throw fail('SESSION_EXPIRED', 401, 'Sessão expirada. Entre novamente.');

      const account = db.prepare('SELECT id, email, display, status FROM accounts WHERE id = ?').get(session.account_id);
      assertAccountActive(account);

      licenses.assertActive(licenses.summary(db, account.id));

      db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(session.id);
      const next = createSession(db, config, account.id, session.device_id, Date.now());
      const issued = tokens.issue(
        { sub: account.id, typ: 'access', device: session.device_id, sid: next.id },
        config.jwtSecret,
        config.accessTtlSeconds
      );
      record(db, 'token_refreshed', { accountId: account.id, detail: session.device_id, ip: context.ip });

      return withLicense(db, account, {
        token: issued.token,
        refreshToken: next.refresh,
        expiresAt: issued.expiresAt
      });
    },

    validate(body, context) {
      const token = context.bearer || (isObject(body) && body.token);
      const claims = tokens.verify(token, config.jwtSecret, 'access');
      const account = db.prepare('SELECT id, email, display, status FROM accounts WHERE id = ?').get(claims.sub);
      assertAccountActive(account);

      const device = db.prepare(
        'SELECT revoked FROM devices WHERE id = ? AND account_id = ?'
      ).get(claims.device, account.id);
      if (!device || device.revoked) throw fail('DEVICE_REVOKED', 403);

      if (claims.sid) {
        const session = db.prepare(
          'SELECT revoked FROM sessions WHERE id = ? AND account_id = ? AND device_id = ?'
        ).get(claims.sid, account.id, claims.device);
        if (session?.revoked) throw fail('SESSION_REVOKED', 401);
      }

      return withLicense(db, account, { token, expiresAt: claims.exp * 1000 });
    },

    license(body, context) {
      const token = context.bearer || (isObject(body) && body.token);
      const claims = tokens.verify(token, config.jwtSecret, 'access');
      const account = db.prepare('SELECT id, email, display, status FROM accounts WHERE id = ?').get(claims.sub);
      assertAccountActive(account);
      const result = withLicense(db, account);
      record(db, 'license_checked', { accountId: account.id, detail: result.license.status, ip: context.ip });
      return result;
    },

    logout(body, context) {
      const token = context.bearer;
      if (!isObject(body) || !text(body.refreshToken, 20, 512)) throw fail('INVALID_INPUT', 400);
      const claims = tokens.verify(token, config.jwtSecret, 'access');
      const hash = tokens.fingerprint(body.refreshToken);
      const session = db.prepare('SELECT account_id FROM sessions WHERE refresh_hash = ?').get(hash);
      if (session && session.account_id === claims.sub) {
        db.prepare('UPDATE sessions SET revoked = 1 WHERE refresh_hash = ?').run(hash);
      }
      record(db, 'logout', { accountId: claims.sub, ip: context.ip });
      return { revoked: Boolean(session) };
    }
  };
}

module.exports = { createAuthService, fail };
