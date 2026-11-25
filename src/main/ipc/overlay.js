'use strict';

const { ipcMain } = require('electron');
const overlay = require('../overlay/service');

const CHANNELS = Object.freeze({
  STATE: 'overlay:state'
});

let registered = false;

function registerOverlayIpc() {
  if (registered) return;
  registered = true;
  ipcMain.handle(CHANNELS.STATE, () => overlay.getState());
}

module.exports = { registerOverlayIpc, CHANNELS };
