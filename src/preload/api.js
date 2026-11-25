'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({
  BOOTSTRAP: 'auth:bootstrap',
  LOGIN: 'auth:login',
  REFRESH: 'auth:refresh',
  LOGOUT: 'auth:logout',
  DIAGNOSTICS: 'auth:diagnostics',
  COPY_DIAGNOSTIC: 'app:copy-diagnostic',
  APP_INFO: 'app:info',
  OPEN_EXTERNAL: 'app:open-external',
  ACCOUNT_SUMMARY: 'account:summary',
  ACCOUNT_DEVICES: 'account:devices',
  ACCOUNT_SESSIONS: 'account:sessions',
  ACCOUNT_REVOKE_DEVICE: 'account:revoke-device',
  ACCOUNT_REVOKE_SESSION: 'account:revoke-session',
  ACCOUNT_REVOKE_OTHERS: 'account:revoke-others',
  UPDATE_CHECK: 'app:update-check',
  UPDATE_INSTALL: 'app:update-install',
  INTEGRITY: 'app:integrity',
  STATS_LIST: 'stats:list',
  STATS_SUMMARY: 'stats:summary',
  STATS_RECORDS: 'stats:records',
  STATS_ANALYTICS: 'stats:analytics',
  STATS_SAVE: 'stats:save',
  SETTINGS_GET: 'settings:get',
  SETTINGS_PUT: 'settings:put',
  OVERLAY_STATE: 'overlay:state'
});

const call = channel => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('lastTraining', {
  auth: {
    bootstrap: () => call(CHANNELS.BOOTSTRAP)(),
    login: credentials => call(CHANNELS.LOGIN)(credentials),
    refresh: () => call(CHANNELS.REFRESH)(),
    logout: () => call(CHANNELS.LOGOUT)(),
    diagnostics: () => call(CHANNELS.DIAGNOSTICS)(),
    appInfo: () => call(CHANNELS.APP_INFO)(),
    accountSummary: () => call(CHANNELS.ACCOUNT_SUMMARY)(),
    accountDevices: () => call(CHANNELS.ACCOUNT_DEVICES)(),
    accountSessions: () => call(CHANNELS.ACCOUNT_SESSIONS)(),
    revokeAccountDevice: deviceId => call(CHANNELS.ACCOUNT_REVOKE_DEVICE)(deviceId),
    revokeAccountSession: sessionId => call(CHANNELS.ACCOUNT_REVOKE_SESSION)(sessionId),
    revokeOtherAccountSessions: () => call(CHANNELS.ACCOUNT_REVOKE_OTHERS)()
  },
  system: {
    checkUpdate: () => call(CHANNELS.UPDATE_CHECK)(),
    installUpdate: () => call(CHANNELS.UPDATE_INSTALL)(),
    integrity: () => call(CHANNELS.INTEGRITY)(),
    copyDiagnostic: text => call(CHANNELS.COPY_DIAGNOSTIC)(text),
    openExternal: url => call(CHANNELS.OPEN_EXTERNAL)(url)
  },
  stats: {
    list: () => call(CHANNELS.STATS_LIST)(),
    summary: () => call(CHANNELS.STATS_SUMMARY)(),
    records: () => call(CHANNELS.STATS_RECORDS)(),
    analytics: filter => call(CHANNELS.STATS_ANALYTICS)(filter),
    save: result => call(CHANNELS.STATS_SAVE)(result)
  },
  settings: {
    get: () => call(CHANNELS.SETTINGS_GET)(),
    put: patch => call(CHANNELS.SETTINGS_PUT)(patch)
  },
  overlay: {
    state: () => call(CHANNELS.OVERLAY_STATE)()
  }
});
