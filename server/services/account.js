'use strict';

const tokens = require('../security/tokens');
const { uuid, isObject } = require('../security/validate');
const { record } = require('./audit');
const licenses = require('./license');

function fail(code, status, message, retryAfter = 0) {
  const error = new Error(message || 'Operação de conta negada.');
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
    status: row.status
  };
}

function cleanDevice(row, currentDeviceId) {
  return {
    id: row.id,
    name: row.name,
    ip: row.ip || '',
    hwid: row.hwid || '',
    createdAt: row.created_at,
    lastSeen: row.last_seen,
    revoked: Boolean(row.revoked),
    current: row.id === currentDeviceId
  };
}

function cleanSession(row, currentSessionId) {
  return {
    id: row.id,
    deviceId: row.device_id,
    deviceName: row.device_name || '',
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revoked: Boolean(row.revoked),
    current: row.id === currentSessionId
  };
}

function createAccountService({ db, config, limiter }) {
  function authorize(context) {
    const verdict = limiter.hit(`account:${context.ip}`, config.globalMaxPerMinute, 60000);
    if (!verdict.allowed) {
      throw fail('RATE_LIMITED', 429, 'Muitas requisições de conta. Aguarde instantes.', verdict.retryAfter);
    }

    const claims = tokens.verify(context.bearer, config.jwtSecret, 'access');
    const account = db.prepare(
      'SELECT id, email, display, status FROM accounts WHERE id = ?'
    ).get(claims.sub);
    if (!account || account.status !== 'active') throw fail('ACCOUNT_BLOCKED', 403);

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

    return { account, claims };
  }

  function listDevices(accountId, currentDeviceId) {
    return db.prepare(
      `SELECT id, name, ip, hwid, created_at, last_seen, revoked
       FROM devices WHERE account_id = ? ORDER BY revoked ASC, last_seen DESC LIMIT 100`
    ).all(accountId).map(row => cleanDevice(row, currentDeviceId));
  }

  function listSessions(accountId, currentSessionId) {
    return db.prepare(
      `SELECT s.id, s.device_id, d.name AS device_name, s.created_at, s.expires_at, s.revoked
       FROM sessions s LEFT JOIN devices d ON d.id = s.device_id
       WHERE s.account_id = ? ORDER BY s.revoked ASC, s.created_at DESC LIMIT 100`
    ).all(accountId).map(row => cleanSession(row, currentSessionId));
  }

  return {
    summary(body, context) {
      const { account, claims } = authorize(context);
      const counts = db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM devices WHERE account_id = ? AND revoked = 0) AS devices,
           (SELECT COUNT(*) FROM sessions WHERE account_id = ? AND revoked = 0 AND expires_at > ?) AS sessions`
      ).get(account.id, account.id, Date.now());
      const device = db.prepare(
        'SELECT name, ip, hwid FROM devices WHERE id = ? AND account_id = ?'
      ).get(claims.device, account.id) || {};
      const result = {
        account: publicAccount(account),
        license: licenses.summary(db, account.id),
        counts: { devices: counts.devices, sessions: counts.sessions },
        currentDevice: {
          id: claims.device || '',
          name: device.name || '',
          ip: device.ip || '',
          hwid: device.hwid || ''
        },
        currentSessionId: claims.sid || '',
        serverTime: Date.now()
      };
      record(db, 'account_summary_viewed', { accountId: account.id, detail: claims.device || '', ip: context.ip });
      return result;
    },

    devices(body, context) {
      const { account, claims } = authorize(context);
      const result = listDevices(account.id, claims.device);
      record(db, 'account_devices_viewed', { accountId: account.id, detail: String(result.length), ip: context.ip });
      return result;
    },

    sessions(body, context) {
      const { account, claims } = authorize(context);
      const result = listSessions(account.id, claims.sid);
      record(db, 'account_sessions_viewed', { accountId: account.id, detail: String(result.length), ip: context.ip });
      return result;
    },

    revokeDevice(body, context) {
      if (!isObject(body) || !uuid(body.deviceId)) throw fail('INVALID_INPUT', 400);
      const { account, claims } = authorize(context);
      if (body.deviceId === claims.device) throw fail('CANNOT_REVOKE_CURRENT', 400);

      const device = db.prepare('SELECT id FROM devices WHERE id = ? AND account_id = ?').get(body.deviceId, account.id);
      if (!device) throw fail('DEVICE_NOT_FOUND', 404);

      db.prepare('UPDATE devices SET revoked = 1 WHERE id = ?').run(body.deviceId);
      const revoked = db.prepare('UPDATE sessions SET revoked = 1 WHERE device_id = ? AND revoked = 0').run(body.deviceId).changes;
      record(db, 'account_device_revoked', {
        accountId: account.id,
        detail: `${body.deviceId}:${revoked}`,
        ip: context.ip
      });
      return { revoked: true, sessions: revoked };
    },

    revokeSession(body, context) {
      if (!isObject(body) || !uuid(body.sessionId)) throw fail('INVALID_INPUT', 400);
      const { account, claims } = authorize(context);
      if (body.sessionId === claims.sid) throw fail('CANNOT_REVOKE_CURRENT', 400);

      const session = db.prepare('SELECT id FROM sessions WHERE id = ? AND account_id = ?').get(body.sessionId, account.id);
      if (!session) throw fail('SESSION_NOT_FOUND', 404);

      db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(body.sessionId);
      record(db, 'account_session_revoked', {
        accountId: account.id,
        detail: body.sessionId,
        ip: context.ip
      });
      return { revoked: true };
    },

    revokeOtherSessions(body, context) {
      const { account, claims } = authorize(context);
      const revoked = claims.sid
        ? db.prepare(
            'UPDATE sessions SET revoked = 1 WHERE account_id = ? AND revoked = 0 AND id <> ?'
          ).run(account.id, claims.sid).changes
        : db.prepare(
            'UPDATE sessions SET revoked = 1 WHERE account_id = ? AND revoked = 0 AND device_id <> ?'
          ).run(account.id, claims.device).changes;
      record(db, 'account_other_sessions_revoked', {
        accountId: account.id,
        detail: String(revoked),
        ip: context.ip
      });
      return { revoked };
    }
  };
}

module.exports = { createAccountService };
