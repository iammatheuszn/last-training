'use strict';

const { app, clipboard, ipcMain } = require('electron');
const {
  provider,
  AuthError,
  CODES,
  MESSAGES,
  describeError
} = require('../auth/provider');
const { assertActive } = require('../auth/license');
const sessionStore = require('../auth/session');
const deviceStore = require('../auth/device');
const overlay = require('../overlay/service');

const CHANNELS = Object.freeze({
  BOOTSTRAP: 'auth:bootstrap',
  LOGIN: 'auth:login',
  REFRESH: 'auth:refresh',
  LOGOUT: 'auth:logout',
  DIAGNOSTICS: 'auth:diagnostics',
  COPY_DIAGNOSTIC: 'app:copy-diagnostic',
  APP_INFO: 'app:info',
  ACCOUNT_SUMMARY: 'account:summary',
  ACCOUNT_DEVICES: 'account:devices',
  ACCOUNT_SESSIONS: 'account:sessions',
  ACCOUNT_REVOKE_DEVICE: 'account:revoke-device',
  ACCOUNT_REVOKE_SESSION: 'account:revoke-session',
  ACCOUNT_REVOKE_OTHERS: 'account:revoke-others'
});

let registered = false;
let currentSession = null;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isText = (value, min, max) =>
  typeof value === 'string' && value.trim().length >= min && value.length <= max;

function failure(code, detail = {}) {
  return { ok: false, error: { code, message: MESSAGES[code] || 'Falha na autenticação.', ...detail } };
}

function failureFrom(error) {
  const detail = describeError(error);
  if (!detail) return failure(CODES.SERVER_UNAVAILABLE);
  const { code, message, ...rest } = detail;
  return failure(code, { message, ...rest });
}

function redact(text) {
  return text
    .replace(/(senha|password|authorization|bearer)\s*[:=]\s*\S+/gi, '$1: [redacted]')
    .slice(0, 12000);
}

function activeToken() {
  const saved = sessionStore.load();
  if (saved?.accessToken) return saved.accessToken;
  return currentSession?.token || '';
}

async function withAccount(operation) {
  try {
    const token = activeToken();
    if (!token) return failure(CODES.SESSION_REVOKED);
    return { ok: true, data: await operation(token) };
  } catch (error) {
    return failureFrom(error);
  }
}

function publicSession(session) {
  return {
    authenticated: true,
    account: session.account,
    license: session.license,
    expiresAt: session.expiresAt || 0
  };
}

function persist(session, remember) {
  currentSession = session;
  overlay.setAuthenticated(true);
  if (!remember) {
    sessionStore.clear();
    return false;
  }
  return sessionStore.save(session);
}

async function recover() {
  overlay.setAuthenticated(false);
  const saved = sessionStore.load();
  if (!saved) return { ok: true, data: { authenticated: false, reason: 'no-session' } };
  const device = deviceStore.ensure();
  if (saved.deviceId !== device.id) {
    sessionStore.clear();
    return { ok: true, data: { authenticated: false, reason: 'invalid' } };
  }

  try {
    let session = await provider.validateSession(saved.accessToken);
    session.deviceId = saved.deviceId;
    assertActive(session);

    if (!session.refreshToken) {
      session = await provider.refreshSession({ refreshToken: saved.refreshToken });
      session.deviceId = saved.deviceId;
      assertActive(session);
    }

    const persisted = persist(session, true);
    return { ok: true, data: { ...publicSession(session), reason: 'valid', persisted } };
  } catch (error) {
    const code = error instanceof AuthError ? error.code : CODES.SERVER_UNAVAILABLE;
    if (code === CODES.SERVER_UNAVAILABLE || code === CODES.NOT_CONFIGURED) {
      currentSession = null;
      overlay.setAuthenticated(false);
      return { ok: true, data: { authenticated: false, reason: 'offline' } };
    }
    if (code === CODES.SESSION_EXPIRED || code === CODES.SESSION_REVOKED) {
      try {
        const session = await provider.refreshSession({ refreshToken: saved.refreshToken });
        session.deviceId = saved.deviceId;
        assertActive(session);
        const persisted = persist(session, true);
        return { ok: true, data: { ...publicSession(session), reason: 'refreshed', persisted } };
      } catch {
        sessionStore.clear();
        currentSession = null;
        overlay.setAuthenticated(false);
        return { ok: true, data: { authenticated: false, reason: 'invalid' } };
      }
    }
    sessionStore.clear();
    currentSession = null;
    overlay.setAuthenticated(false);
    return { ok: true, data: { authenticated: false, reason: 'invalid' } };
  }
}

function registerAuthIpc() {
  if (registered) return;
  registered = true;

  ipcMain.handle(CHANNELS.APP_INFO, () => ({
    version: app.getVersion(),
    authConfigured: provider.configured(),
    sessionEncrypted: sessionStore.encrypted()
  }));

  ipcMain.handle(CHANNELS.DIAGNOSTICS, async () => {
    try {
      return { ok: true, data: await provider.diagnostics() };
    } catch (error) {
      return failureFrom(error);
    }
  });

  ipcMain.handle(CHANNELS.COPY_DIAGNOSTIC, (_event, text) => {
    if (typeof text !== 'string' || !text.trim() || text.length > 12000) {
      return { ok: false, error: { code: CODES.INVALID_INPUT, message: MESSAGES[CODES.INVALID_INPUT] } };
    }
    clipboard.writeText(redact(text));
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.ACCOUNT_SUMMARY, () =>
    withAccount(token => provider.accountSummary(token)));
  ipcMain.handle(CHANNELS.ACCOUNT_DEVICES, () =>
    withAccount(token => provider.accountDevices(token)));
  ipcMain.handle(CHANNELS.ACCOUNT_SESSIONS, () =>
    withAccount(token => provider.accountSessions(token)));

  ipcMain.handle(CHANNELS.ACCOUNT_REVOKE_DEVICE, (_event, deviceId) => {
    if (!UUID_PATTERN.test(deviceId || '')) return failure(CODES.INVALID_INPUT);
    return withAccount(token => provider.revokeAccountDevice({ token, deviceId }));
  });

  ipcMain.handle(CHANNELS.ACCOUNT_REVOKE_SESSION, (_event, sessionId) => {
    if (!UUID_PATTERN.test(sessionId || '')) return failure(CODES.INVALID_INPUT);
    return withAccount(token => provider.revokeAccountSession({ token, sessionId }));
  });

  ipcMain.handle(CHANNELS.ACCOUNT_REVOKE_OTHERS, () =>
    withAccount(token => provider.revokeOtherAccountSessions(token)));

  ipcMain.handle(CHANNELS.BOOTSTRAP, recover);

  ipcMain.handle(CHANNELS.LOGIN, async (_event, payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return failure(CODES.INVALID_INPUT);
    const { identity, password, remember } = payload;
    if (!isText(identity, 3, 254) || !isText(password, 1, 256) || typeof remember !== 'boolean') {
      return failure(CODES.INVALID_INPUT);
    }

    try {
      const device = deviceStore.ensure();
      const session = await provider.authenticate({
        identity: identity.trim(),
        password,
        device: { id: device.id, name: device.name, hwid: device.hwid }
      });
      session.deviceId = device.id;
      assertActive(session);
      const persisted = persist(session, remember);
      return { ok: true, data: { ...publicSession(session), persisted } };
    } catch (error) {
      return failureFrom(error);
    }
  });

  ipcMain.handle(CHANNELS.REFRESH, async () => {
    const saved = sessionStore.load();
    if (!saved) return { ok: false, error: { code: CODES.SESSION_REVOKED, message: MESSAGES[CODES.SESSION_REVOKED] } };
    try {
      const session = await provider.refreshSession({ refreshToken: saved.refreshToken });
      session.deviceId = saved.deviceId;
      assertActive(session);
      const persisted = persist(session, true);
      return { ok: true, data: { ...publicSession(session), persisted } };
    } catch (error) {
      const code = error instanceof AuthError ? error.code : CODES.SERVER_UNAVAILABLE;
      if (code === CODES.SESSION_EXPIRED || code === CODES.SESSION_REVOKED) {
        sessionStore.clear();
        currentSession = null;
        overlay.setAuthenticated(false);
      }
      return failureFrom(error);
    }
  });

  ipcMain.handle(CHANNELS.LOGOUT, async () => {
    const saved = sessionStore.load();
    if (saved) {
      try {
        await provider.revokeSession({ token: saved.accessToken, refreshToken: saved.refreshToken });
      } catch {
      }
    }
    sessionStore.clear();
    currentSession = null;
    overlay.setAuthenticated(false);
    return { ok: true };
  });
}

module.exports = { registerAuthIpc, CHANNELS };
