'use strict';

const { version } = require('../../package.json');

function checkDatabase(db) {
  const result = db.prepare('PRAGMA quick_check').all();
  const ok = result.length > 0 && result.every(row => String(row.quick_check).toLowerCase() === 'ok');
  return { ok, detail: ok ? 'quick_check ok' : 'quick_check falhou' };
}

function count(db, sql, params = []) {
  try {
    return db.prepare(sql).get(...params).total;
  } catch {
    return 0;
  }
}

function createHealthService({ db, config }) {
  return {
    report() {
      const warnings = [];
      let database;
      try {
        database = checkDatabase(db);
      } catch {
        database = { ok: false, detail: 'banco inacessível' };
      }

      const licenses = {
        ok: true,
        active: count(db, "SELECT COUNT(*) AS total FROM licenses WHERE status = 'active'"),
        blocked: count(db, "SELECT COUNT(*) AS total FROM licenses WHERE status IN ('blocked','suspended','canceled','expired')")
      };
      if (licenses.active === 0) warnings.push('NENHUMA_LICENCA_ATIVA');

      const auth = {
        ok: !config.ephemeralSecret,
        ephemeralSecret: Boolean(config.ephemeralSecret),
        accessTtlSeconds: config.accessTtlSeconds,
        refreshTtlDays: config.refreshTtlDays
      };
      if (config.ephemeralSecret) warnings.push('SEGREDO_EFEREMERO');

      const audit = {
        ok: true,
        events: count(db, 'SELECT COUNT(*) AS total FROM audit'),
        lastAt: db.prepare('SELECT at FROM audit ORDER BY id DESC LIMIT 1').get()?.at || null
      };

      const checks = { database, auth, licenses, audit };
      const healthy = database.ok && licenses.ok && audit.ok;
      return {
        ok: healthy,
        status: healthy ? warnings.length ? 'degraded' : 'ok' : 'fail',
        version,
        environment: config.environment,
        serverTime: new Date().toISOString(),
        tls: Boolean(config.tlsTerminated || (config.tlsKey && config.tlsCert)),
        warnings,
        checks,
        counts: {
          accounts: count(db, 'SELECT COUNT(*) AS total FROM accounts'),
          devices: count(db, 'SELECT COUNT(*) AS total FROM devices'),
          sessions: count(db, 'SELECT COUNT(*) AS total FROM sessions'),
          activeSessions: count(db, 'SELECT COUNT(*) AS total FROM sessions WHERE revoked = 0 AND expires_at > ?', [Date.now()]),
          audit: audit.events
        }
      };
    }
  };
}

module.exports = { createHealthService };
