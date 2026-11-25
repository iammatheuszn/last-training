'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { assertEnvironment, trustedList } = require('./env');

function integer(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} deve ser um inteiro entre ${min} e ${max}`);
  }
  return parsed;
}

function boolean(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (['1', 'true', 'sim', 'yes', 'on'].includes(String(raw).toLowerCase())) return true;
  if (['0', 'false', 'nao', 'no', 'off'].includes(String(raw).toLowerCase())) return false;
  throw new Error(`${name} deve ser true ou false`);
}

function createConfig(overrides = {}) {
  const environment = overrides.environment || process.env.LT_ENV || 'development';
  const jwtSecret = overrides.jwtSecret || process.env.AUTH_JWT_SECRET || '';
  const ephemeralSecret = !jwtSecret;
  const tlsTerminated = overrides.tlsTerminated !== undefined
    ? Boolean(overrides.tlsTerminated)
    : String(process.env.LT_TLS_TERMINATED || '').toLowerCase() === 'true';

  assertEnvironment({}, {
    mode: environment,
    overrides: {
      LT_ENV: environment,
      AUTH_JWT_SECRET: jwtSecret,
      LT_PUBLIC_ORIGIN: overrides.publicOrigin || process.env.LT_PUBLIC_ORIGIN || '',
      LT_DB_PATH: overrides.dbPath || process.env.LT_DB_PATH || '',
      LT_TLS_KEY: overrides.tlsKey || process.env.LT_TLS_KEY || '',
      LT_TLS_CERT: overrides.tlsCert || process.env.LT_TLS_CERT || '',
      LT_TLS_TERMINATED: tlsTerminated ? 'true' : '',
      LT_BASE_URL: overrides.baseUrl || process.env.LT_BASE_URL || '',
      LT_AUTH_API_BASE_URL: overrides.authApiBaseUrl || process.env.LT_AUTH_API_BASE_URL || '',
      LT_UPDATE_URL: overrides.updateUrl || process.env.LT_UPDATE_URL || ''
    }
  });

  return {
    environment,
    production: environment === 'production',
    host: overrides.host || process.env.LT_SERVER_HOST || '127.0.0.1',
    port: overrides.port ?? integer('LT_SERVER_PORT', 8787, 1, 65535),
    publicOrigin: overrides.publicOrigin || process.env.LT_PUBLIC_ORIGIN || '',
    dbPath: overrides.dbPath || process.env.LT_DB_PATH || path.join(__dirname, 'data', 'last-training.db'),
    jwtSecret: jwtSecret || crypto.randomBytes(32).toString('hex'),
    ephemeralSecret,
    tlsKey: overrides.tlsKey || process.env.LT_TLS_KEY || '',
    tlsCert: overrides.tlsCert || process.env.LT_TLS_CERT || '',
    tlsTerminated,
    trustProxy: overrides.trustProxy ?? boolean('LT_TRUST_PROXY'),
    trustedProxies: trustedList(overrides.trustedProxies || process.env.LT_TRUSTED_PROXIES),
    backupDir: overrides.backupDir || process.env.LT_BACKUP_DIR || path.join(__dirname, 'backups'),
    backupRetention: overrides.backupRetention ?? integer('LT_BACKUP_RETENTION', 7, 1, 365),
    logDir: overrides.logDir || process.env.LT_LOG_DIR || path.join(__dirname, 'logs'),
    accessTtlSeconds: overrides.accessTtlSeconds ?? integer('LT_ACCESS_TTL', 900, 60, 86400),
    refreshTtlDays: overrides.refreshTtlDays ?? integer('LT_REFRESH_TTL_DAYS', 30, 1, 365),
    maxDevices: overrides.maxDevices ?? integer('LT_MAX_DEVICES', 3, 1, 20),
    loginMaxFailures: overrides.loginMaxFailures ?? integer('LT_LOGIN_MAX_FAILURES', 5, 2, 50),
    loginWindowMs: overrides.loginWindowMs ?? integer('LT_LOGIN_WINDOW_MS', 600000, 10000, 86400000),
    loginLockMs: overrides.loginLockMs ?? integer('LT_LOGIN_LOCK_MS', 900000, 10000, 86400000),
    globalMaxPerMinute: overrides.globalMaxPerMinute ?? integer('LT_GLOBAL_MAX_PER_MINUTE', 180, 10, 10000),
    requestIdTtlMs: overrides.requestIdTtlMs ?? integer('LT_REQUEST_ID_TTL_MS', 300000, 10000, 3600000),
    adminTtlSeconds: overrides.adminTtlSeconds ?? integer('LT_ADMIN_TTL', 900, 60, 86400),
    adminLoginMaxFailures: overrides.adminLoginMaxFailures ?? integer('LT_ADMIN_LOGIN_MAX_FAILURES', 5, 2, 50),
    adminLoginWindowMs: overrides.adminLoginWindowMs ?? integer('LT_ADMIN_LOGIN_WINDOW_MS', 900000, 10000, 86400000),
    adminLoginLockMs: overrides.adminLoginLockMs ?? integer('LT_ADMIN_LOGIN_LOCK_MS', 900000, 10000, 86400000)
  };
}

module.exports = { createConfig };
