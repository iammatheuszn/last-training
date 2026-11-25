'use strict';

const { BrowserWindow, app, screen } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const settingsStore = require('../settings/store');

const TICK_MS = 16;
const WINDOW_SIZE = 120;
const DEV_URL = 'http://127.0.0.1:5173/overlay.html';

let started = false;
let overlayWindow = null;
let ticker = null;
let unsubscribe = null;
let authenticated = false;
let appFocused = true;
let currentSettings = settingsStore.getSettings();
let currentConfig = null;
let displayId = '';

function overlayUrl() {
  if (!app.isPackaged && process.env.NODE_ENV !== 'production') return DEV_URL;
  return pathToFileURL(path.join(__dirname, '../../../overlay.html')).href;
}

function sendConfig() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (!overlayWindow.webContents.isLoading()) {
    overlayWindow.webContents.send('overlay:config', { ...currentConfig, visible: visible() });
  }
}

function visible() {
  return Boolean(currentConfig?.enabled && !appFocused);
}

function positionOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (!visible()) return;

  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const area = display.workArea;
  const nextId = `${area.x}:${area.y}:${area.width}:${area.height}`;

  if (currentConfig.mode === 'cursor') {
    overlayWindow.setPosition(
      Math.round(point.x - WINDOW_SIZE / 2),
      Math.round(point.y - WINDOW_SIZE / 2),
      false
    );
    displayId = nextId;
    return;
  }

  if (displayId !== nextId) {
    overlayWindow.setPosition(
      Math.round(area.x + (area.width - WINDOW_SIZE) / 2),
      Math.round(area.y + (area.height - WINDOW_SIZE) / 2),
      false
    );
    displayId = nextId;
  }
}

function startTicker() {
  if (ticker) return;
  ticker = setInterval(positionOverlay, TICK_MS);
  ticker.unref?.();
}

function stopTicker() {
  if (!ticker) return;
  clearInterval(ticker);
  ticker = null;
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return;

  overlayWindow = new BrowserWindow({
    width: WINDOW_SIZE,
    height: WINDOW_SIZE,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../../preload/overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  const url = overlayUrl();
  overlayWindow.webContents.on('will-navigate', (event, target) => {
    if (target !== url) event.preventDefault();
  });
  overlayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlayWindow.webContents.on('did-finish-load', sendConfig);
  overlayWindow.on('closed', () => {
    overlayWindow = null;
    stopTicker();
  });

  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.loadURL(url);
}

function applySettings(settings) {
  currentSettings = settings || settingsStore.getSettings();
  currentConfig = settingsStore.overlayConfig(currentSettings, authenticated);

  if (visible()) {
    createOverlayWindow();
    displayId = '';
    positionOverlay();
    startTicker();
    if (!overlayWindow.isVisible()) overlayWindow.showInactive();
    sendConfig();
    return;
  }

  stopTicker();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (overlayWindow.isVisible()) overlayWindow.hide();
    sendConfig();
  }
}

function startOverlay() {
  if (started) return;
  started = true;
  unsubscribe = settingsStore.subscribe(applySettings);
  applySettings(settingsStore.getSettings());
}

function setAuthenticated(value) {
  authenticated = Boolean(value);
  if (started) applySettings(currentSettings);
}

function setAppFocused(value) {
  appFocused = Boolean(value);
  if (started) applySettings(currentSettings);
}

function getState() {
  const config = currentConfig || settingsStore.overlayConfig(currentSettings, authenticated);
  return { ok: true, data: { ...config, visible: visible() } };
}

function stopOverlay() {
  stopTicker();
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
  overlayWindow = null;
  started = false;
  displayId = '';
}

module.exports = {
  startOverlay,
  stopOverlay,
  setAuthenticated,
  setAppFocused,
  getState
};
