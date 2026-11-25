'use strict';

const crypto = require('node:crypto');
const tokens = require('../security/tokens');
const passwords = require('../security/passwords');
const { uuid, text, email, oneOf, isObject } = require('../security/validate');
const { record } = require('./audit');
const licenses = require('./license');

const STATUSES = Object.freeze(['active', 'expired', 'suspended', 'canceled', 'blocked']);
const ACCOUNT_STATUSES = Object.freeze(['active', 'blocked']);
const PLANS = Object.freeze(['free', 'pro', 'team']);

function fail(code, status, message, retryAfter = 0) {
  const error = new Error(message || 'Operação administrativa negada.');
  error.code = code;
  error.status = status;
  error.retryAfter = retryAfter;
  return error;
}

function publicAccount(row) {
  return {
    id: row.id,
    display: row.display,
    email: row.email,
    status: row.status,
    role: row.role,
    createdAt: row.created_at
  };
}

function cleanFeatures(value) {
  if (value === undefined || value === null) {
    return [
      'tracking', 'clicking', 'flick', 'switching', 'precision', 'speed',
      'crosshair_follow', 'crosshair_stability', 'crosshair_grid'
    ];
  }
  if (!Array.isArray(value) || value.length > 32) throw fail('INVALID_INPUT', 400);
  const features = value
    .filter(item => typeof item === 'string' && item.trim().length >= 1 && item.length <= 64)
    .map(item => item.trim());
  if (features.length !== value.length) throw fail('INVALID_INPUT', 400);
  return features;
}

function cleanExpiresAt(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!text(value, 4, 64)) throw fail('INVALID_INPUT', 400);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw fail('INVALID_INPUT', 400);
  return new Date(parsed).toISOString();
}

function accountById(db, id) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

function requireAccount(db, id) {
  const account = accountById(db, id);
  if (!account) throw fail('ACCOUNT_NOT_FOUND', 404);
  return account;
}

function accountOverview(db, row) {
  const devices = db.prepare(
    'SELECT COUNT(*) AS total FROM devices WHERE account_id = ? AND revoked = 0'
  ).get(row.id).total;
  const sessions = db.prepare(
    'SELECT COUNT(*) AS total FROM sessions WHERE account_id = ? AND revoked = 0 AND expires_at > ?'
  ).get(row.id, Date.now()).total;
  return { ...publicAccount(row), license: licenses.summary(db, row.id), devices, sessions };
}

function createAdminService({ db, config, limiter, nonces }) {
  function assertAdmin(token) {
    const claims = tokens.verify(token, config.jwtSecret);
    const account = accountById(db, claims.sub);
    if (claims.typ !== 'admin' || claims.role !== 'admin' ||
        !account || account.status !== 'active' || account.role !== 'admin') {
      throw fail('FORBIDDEN', 403);
    }
    return account;
  }

  function guard(context, operation) {
    const global = limiter.hit(`admin:${context.ip}`, config.globalMaxPerMinute, 60000);
    if (!global.allowed) {
      throw fail('RATE_LIMITED', 429, 'Muitas requisições administrativas. Aguarde instantes.', global.retryAfter);
    }
    const admin = assertAdmin(context.bearer);
    return { admin, result: operation(admin) };
  }

  function loginLockKey(context) {
    return `admin-lock:${context.ip}`;
  }

  function engageLoginLock(context) {
    limiter.hit(loginLockKey(context), 1, config.adminLoginLockMs);
    return Math.ceil(config.adminLoginLockMs / 1000);
  }

  function noteFailure(context) {
    const key = `admin-login:${context.ip}`;
    const verdict = limiter.hit(key, config.adminLoginMaxFailures, config.adminLoginWindowMs);
    record(db, 'admin_login_failed', { ip: context.ip });
    if (!verdict.allowed) {
      limiter.clear(key);
      return { retryAfter: engageLoginLock(context) };
    }
    return { retryAfter: verdict.retryAfter };
  }

  function revokeSessionsInternal(accountId) {
    return db.prepare('UPDATE sessions SET revoked = 1 WHERE account_id = ? AND revoked = 0').run(accountId).changes;
  }

  return {
    login(body, context) {
      if (!isObject(body) || !text(body.identity, 3, 254) || !text(body.password, 1, 256)) {
        throw fail('INVALID_INPUT', 400);
      }
      const global = limiter.hit(`admin-global:${context.ip}`, config.globalMaxPerMinute, 60000);
      if (!global.allowed) {
        throw fail('RATE_LIMITED', 429, 'Muitas requisições administrativas. Aguarde instantes.', global.retryAfter);
      }

      const key = `admin-login:${context.ip}`;
      const lock = limiter.check(loginLockKey(context), 1, config.adminLoginLockMs);
      if (!lock.allowed) {
        throw fail('RATE_LIMITED', 429, 'Muitas tentativas administrativas. Aguarde antes de continuar.', lock.retryAfter);
      }
      const failures = limiter.check(key, config.adminLoginMaxFailures, config.adminLoginWindowMs);
      if (!failures.allowed) {
        throw fail('RATE_LIMITED', 429, 'Muitas tentativas administrativas. Aguarde antes de continuar.', engageLoginLock(context));
      }

      const identity = body.identity.trim();
      const account = db.prepare(
        'SELECT * FROM accounts WHERE email = ? COLLATE NOCASE OR display = ? COLLATE NOCASE'
      ).get(identity, identity);
      const valid = account && account.role === 'admin' && account.status === 'active' &&
        passwords.verify(body.password, account.password_hash);

      if (!valid) {
        const failure = noteFailure(context);
        throw fail('INVALID_CREDENTIALS', 401, 'Credenciais administrativas inválidas.', failure.retryAfter);
      }

      limiter.clear(key);
      limiter.clear(loginLockKey(context));
      const issued = tokens.issue(
        { sub: account.id, typ: 'admin', role: 'admin' },
        config.jwtSecret,
        config.adminTtlSeconds
      );
      record(db, 'admin_login_success', { accountId: account.id, ip: context.ip });
      return {
        token: issued.token,
        expiresAt: issued.expiresAt,
        account: publicAccount(account)
      };
    },

    listAccounts(body, context) {
      const { admin } = guard(context, () => {});
      const rows = db.prepare(
        'SELECT * FROM accounts ORDER BY created_at DESC, rowid DESC LIMIT 200'
      ).all();
      record(db, 'admin_accounts_listed', { accountId: admin.id, detail: String(rows.length), ip: context.ip });
      return rows.map(row => accountOverview(db, row));
    },

    createAccount(body, context) {
      if (!isObject(body) || !email(body.email) || !text(body.display, 2, 80) || !text(body.password, 10, 256)) {
        throw fail('INVALID_INPUT', 400);
      }
      const plan = body.plan === undefined ? 'free' : body.plan;
      const status = body.status === undefined ? 'active' : body.status;
      if (!oneOf(plan, PLANS) || !oneOf(status, STATUSES)) throw fail('INVALID_INPUT', 400);
      const features = cleanFeatures(body.features);
      const expiresAt = cleanExpiresAt(body.expiresAt);
      const identity = body.email.trim().toLowerCase();

      const { result } = guard(context, admin => {
        if (db.prepare('SELECT id FROM accounts WHERE email = ? COLLATE NOCASE').get(identity)) {
          throw fail('EMAIL_IN_USE', 409, 'Este e-mail já possui conta.');
        }
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        try {
          db.prepare(
            'INSERT INTO accounts (id, email, display, password_hash, status, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(id, identity, body.display.trim(), passwords.hash(body.password), 'active', 'user', now);
          db.prepare(
            `INSERT INTO licenses (account_id, plan, status, expires_at, features, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(id, plan, status, expiresAt, JSON.stringify(features), now);
        } catch (error) {
          if (String(error.code || '').includes('CONSTRAINT')) throw fail('EMAIL_IN_USE', 409);
          throw error;
        }
        record(db, 'admin_account_created', { accountId: admin.id, detail: id, ip: context.ip });
        return accountOverview(db, requireAccount(db, id));
      });
      return result;
    },

    updateLicense(body, context) {
      if (!isObject(body) || !uuid(body.accountId)) throw fail('INVALID_INPUT', 400);
      if (!oneOf(body.plan, PLANS) || !oneOf(body.status, STATUSES)) throw fail('INVALID_INPUT', 400);
      const features = cleanFeatures(body.features);
      const expiresAt = cleanExpiresAt(body.expiresAt);

      const { result } = guard(context, admin => {
        requireAccount(db, body.accountId);
        db.prepare(
          `UPDATE licenses SET plan = ?, status = ?, expires_at = ?, features = ?, updated_at = ?
           WHERE account_id = ?`
        ).run(body.plan, body.status, expiresAt, JSON.stringify(features), new Date().toISOString(), body.accountId);
        record(db, 'admin_license_updated', {
          accountId: admin.id,
          detail: `${body.accountId}:${body.status}:${body.plan}`,
          ip: context.ip
        });
        return accountOverview(db, requireAccount(db, body.accountId));
      });
      return result;
    },

    setAccountStatus(body, context) {
      if (!isObject(body) || !uuid(body.accountId) || !oneOf(body.status, ACCOUNT_STATUSES)) {
        throw fail('INVALID_INPUT', 400);
      }
      const { result } = guard(context, admin => {
        requireAccount(db, body.accountId);
        db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run(body.status, body.accountId);
        if (body.status === 'blocked') revokeSessionsInternal(body.accountId);
        record(db, 'admin_account_status', {
          accountId: admin.id,
          detail: `${body.accountId}:${body.status}`,
          ip: context.ip
        });
        return accountOverview(db, requireAccount(db, body.accountId));
      });
      return result;
    },

    listDevices(body, context) {
      if (!isObject(body) || (body.accountId !== undefined && body.accountId !== null && !uuid(body.accountId))) {
        throw fail('INVALID_INPUT', 400);
      }
      const accountId = body.accountId || null;
      const { result } = guard(context, admin => {
        if (accountId) requireAccount(db, accountId);
        const rows = accountId
          ? db.prepare(
              `SELECT id, name, ip, hwid, account_id AS accountId, created_at AS createdAt,
                      last_seen AS lastSeen, revoked
               FROM devices WHERE account_id = ? ORDER BY last_seen DESC LIMIT 100`
            ).all(accountId)
          : db.prepare(
              `SELECT d.id, d.name, d.ip, d.hwid, d.account_id AS accountId, a.email AS accountEmail,
                      d.created_at AS createdAt, d.last_seen AS lastSeen, d.revoked
               FROM devices d JOIN accounts a ON a.id = d.account_id
               ORDER BY d.last_seen DESC LIMIT 200`
            ).all();
        record(db, 'admin_devices_listed', { accountId: admin.id, detail: accountId || 'all', ip: context.ip });
        return rows.map(row => ({ ...row, revoked: Boolean(row.revoked) }));
      });
      return result;
    },

    listSessions(body, context) {
      const { result } = guard(context, admin => {
        const rows = db.prepare(
          `SELECT s.id, s.account_id AS accountId, a.email AS accountEmail,
                  s.device_id AS deviceId, d.name AS deviceName,
                  s.created_at AS createdAt, s.expires_at AS expiresAt, s.revoked
           FROM sessions s
           JOIN accounts a ON a.id = s.account_id
           LEFT JOIN devices d ON d.id = s.device_id
           ORDER BY s.created_at DESC LIMIT 200`
        ).all();
        record(db, 'admin_sessions_listed', { accountId: admin.id, detail: String(rows.length), ip: context.ip });
        return rows.map(row => ({ ...row, revoked: Boolean(row.revoked) }));
      });
      return result;
    },

    revokeDevice(body, context) {
      if (!isObject(body) || !uuid(body.deviceId)) throw fail('INVALID_INPUT', 400);
      const { result } = guard(context, admin => {
        const device = db.prepare('SELECT id, account_id FROM devices WHERE id = ?').get(body.deviceId);
        if (!device) throw fail('DEVICE_NOT_FOUND', 404);
        db.prepare('UPDATE devices SET revoked = 1 WHERE id = ?').run(body.deviceId);
        db.prepare('UPDATE sessions SET revoked = 1 WHERE device_id = ?').run(body.deviceId);
        record(db, 'admin_device_revoked', { accountId: admin.id, detail: body.deviceId, ip: context.ip });
        return { revoked: true, accountId: device.account_id };
      });
      return result;
    },

    revokeSessions(body, context) {
      if (!isObject(body) || !uuid(body.accountId)) throw fail('INVALID_INPUT', 400);
      const { result } = guard(context, admin => {
        requireAccount(db, body.accountId);
        const revoked = revokeSessionsInternal(body.accountId);
        record(db, 'admin_sessions_revoked', {
          accountId: admin.id,
          detail: `${body.accountId}:${revoked}`,
          ip: context.ip
        });
        return { revoked };
      });
      return result;
    },

    resetPassword(body, context) {
      if (!isObject(body) || !uuid(body.accountId) || !text(body.password, 10, 256)) {
        throw fail('INVALID_INPUT', 400);
      }
      const { result } = guard(context, admin => {
        requireAccount(db, body.accountId);
        db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?')
          .run(passwords.hash(body.password), body.accountId);
        const revoked = revokeSessionsInternal(body.accountId);
        record(db, 'admin_password_reset', {
          accountId: admin.id,
          detail: `${body.accountId}:${revoked}`,
          ip: context.ip
        });
        return { updated: true, revoked };
      });
      return result;
    },

    listAudit(body, context) {
      const requested = isObject(body) ? Number(body.limit) : 50;
      const limit = Number.isFinite(requested) ? Math.max(1, Math.min(100, Math.round(requested))) : 50;
      const { result } = guard(context, admin => {
        const rows = db.prepare(
          `SELECT at, account_id AS accountId, event, detail, ip
           FROM audit ORDER BY id DESC LIMIT ?`
        ).all(limit);
        record(db, 'admin_audit_listed', { accountId: admin.id, detail: String(limit), ip: context.ip });
        return rows;
      });
      return result;
    }
  };
}

module.exports = { createAdminService, STATUSES, ACCOUNT_STATUSES, PLANS };
