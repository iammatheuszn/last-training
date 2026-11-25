'use strict';

const { app, ipcMain } = require('electron');
const path = require('node:path');
const {
  openLocalDb,
  setDatabase,
  closeDatabase,
  saveSession,
  listSessions,
  summary,
  records,
  analytics
} = require('../storage/localDb');

const CHANNELS = Object.freeze({
  LIST: 'stats:list',
  SUMMARY: 'stats:summary',
  RECORDS: 'stats:records',
  ANALYTICS: 'stats:analytics',
  SAVE: 'stats:save'
});

const MESSAGES = Object.freeze({
  INVALID_INPUT: 'Dados de treino inválidos.',
  LOCAL_STORAGE_FAILED: 'Falha ao acessar o banco local de treinos.'
});

let registered = false;

function failure(code) {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}

function guard(operation) {
  try {
    return operation();
  } catch {
    return failure('LOCAL_STORAGE_FAILED');
  }
}

function registerStatsIpc() {
  if (registered) return;
  registered = true;

  const dbPath = process.env.LT_LOCAL_DB_PATH ||
    path.join(app.getPath('userData'), 'last-training.sqlite');
  setDatabase(openLocalDb(dbPath));

  ipcMain.handle(CHANNELS.LIST, () => guard(() => ({
    ok: true,
    data: listSessions(12)
  })));

  ipcMain.handle(CHANNELS.SUMMARY, () => guard(() => ({
    ok: true,
    data: summary()
  })));

  ipcMain.handle(CHANNELS.RECORDS, () => guard(() => ({
    ok: true,
    data: records()
  })));

  ipcMain.handle(CHANNELS.ANALYTICS, (_event, filter) => guard(() => ({
    ok: true,
    data: analytics(filter)
  })));

  ipcMain.handle(CHANNELS.SAVE, (_event, payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return failure('INVALID_INPUT');
    }
    return guard(() => {
      const saved = saveSession(payload);
      if (!saved.ok) return failure('INVALID_INPUT');
      return { ok: true, data: saved.data };
    });
  });
}

function closeStats() {
  closeDatabase();
}

module.exports = { registerStatsIpc, closeStats, CHANNELS };
