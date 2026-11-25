'use strict';

const { ipcMain, shell } = require('electron');
const updates = require('../update/service');
const { verify } = require('../security/integrity');
const path = require('node:path');

const CHANNELS = Object.freeze({
  UPDATE_CHECK: 'app:update-check',
  UPDATE_INSTALL: 'app:update-install',
  INTEGRITY: 'app:integrity',
  OPEN_EXTERNAL: 'app:open-external'
});

const ALLOWED_EXTERNAL = new Set([
  'https://github.com/ianmatheuszn',
  'https://github.com/ianmatheuszn/'
]);

let registered = false;

function trustedExternal(candidate) {
  try {
    const parsed = new URL(String(candidate));
    return parsed.protocol === 'https:' &&
      parsed.hostname.toLowerCase() === 'github.com' &&
      ALLOWED_EXTERNAL.has(`${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`);
  } catch {
    return false;
  }
}

function registerSystemIpc() {
  if (registered) return;
  registered = true;

  ipcMain.handle(CHANNELS.UPDATE_CHECK, async () => updates.check());
  ipcMain.handle(CHANNELS.UPDATE_INSTALL, () => updates.install());
  ipcMain.handle(CHANNELS.INTEGRITY, () =>
    verify(path.join(__dirname, '../../../dist'))
  );
  ipcMain.handle(CHANNELS.OPEN_EXTERNAL, async (_, url) => {
    if (!trustedExternal(url)) return false;
    await shell.openExternal(url);
    return true;
  });
}

module.exports = { registerSystemIpc, CHANNELS, trustedExternal };
