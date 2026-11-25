'use strict';

const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const path = require('path');
const { registerAuthIpc } = require('./ipc/auth');
const { registerSystemIpc } = require('./ipc/system');
const { registerStatsIpc, closeStats } = require('./ipc/stats');
const { registerSettingsIpc } = require('./ipc/settings');
const { registerOverlayIpc } = require('./ipc/overlay');
const overlay = require('./overlay/service');
const { verify } = require('./security/integrity');

const APP_URL = 'http://127.0.0.1:5173';
const ICON = path.join(__dirname, '../../build/icon.ico');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#050505',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, '../preload/api.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  });

  registerAuthIpc();
  registerSystemIpc();
  registerStatsIpc();
  registerSettingsIpc();
  registerOverlayIpc();
  overlay.setAppFocused(true);
  overlay.startOverlay();

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL) && !url.startsWith('file://')) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (!app.isPackaged && process.env.NODE_ENV !== 'production') {
    mainWindow.loadURL(APP_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('focus', () => overlay.setAppFocused(true));
  mainWindow.on('blur', () => overlay.setAppFocused(false));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  app.setAboutPanelOptions({
    applicationName: 'Last Training',
    applicationVersion: app.getVersion(),
    iconPath: ICON
  });

  if (app.isPackaged) {
    const integrity = verify(path.join(__dirname, '../../dist'));
    if (!integrity.ok) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'Last Training',
        message: 'A instalação falhou na verificação de integridade.',
        detail: `Motivo: ${integrity.reason}. Reinstale pelo instalador oficial.`
      });
      app.quit();
      return;
    }
  }

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  overlay.stopOverlay();
  closeStats();
});
