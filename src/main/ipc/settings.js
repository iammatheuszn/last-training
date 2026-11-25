'use strict';

const { app, ipcMain } = require('electron');
const settingsStore = require('../settings/store');

const CHANNELS = Object.freeze({
  GET: 'settings:get',
  PUT: 'settings:put'
});

let registered = false;

function registerSettingsIpc() {
  if (registered) return;
  registered = true;
  settingsStore.configureSettings(settingsStore.settingsPath(app.getPath('userData')));

  ipcMain.handle(CHANNELS.GET, () => ({ ok: true, data: settingsStore.getSettings() }));

  ipcMain.handle(CHANNELS.PUT, (_event, patch) => {
    const result = settingsStore.updateSettings(patch);
    if (!result.ok) {
      return {
        ok: false,
        error: { code: result.error, message: 'Configuração local inválida.' }
      };
    }
    return result;
  });
}

module.exports = { registerSettingsIpc, CHANNELS };
