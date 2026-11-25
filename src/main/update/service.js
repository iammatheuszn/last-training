'use strict';

const { app, dialog } = require('electron');
const { fetchSignedManifest, publicKeyFrom } = require('./signature');

let updater = null;
let signedManifest = null;
let feedError = '';

function baseUrl() {
  return String(process.env.LT_UPDATE_URL || '').trim().replace(/\/+$/, '');
}

function publicKey() {
  return String(process.env.LT_UPDATE_PUBLIC_KEY || '').trim();
}

function configured() {
  return /^https:\/\//i.test(baseUrl()) && Boolean(publicKey());
}

async function verifyFeed() {
  if (!configured()) return null;
  if (signedManifest) return signedManifest;
  try {
    publicKeyFrom(publicKey());
    signedManifest = await fetchSignedManifest(baseUrl(), publicKey());
    feedError = '';
    return signedManifest;
  } catch (error) {
    feedError = error?.message || 'Feed assinado inválido';
    return null;
  }
}

function load() {
  if (updater) return updater;
  if (!configured() || !app.isPackaged || !signedManifest) return null;
  updater = require('electron-updater').autoUpdater;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.setFeedURL({ provider: 'generic', url: baseUrl() });
  updater.on('update-not-available', () => {
    updater.lastResult = 'up-to-date';
  });
  updater.on('update-downloaded', () => {
    updater.lastResult = 'downloaded';
    dialog.showMessageBox({
      type: 'info',
      title: 'Last Training',
      message: 'Atualização pronta. Reinicie o aplicativo para concluir.'
    });
  });
  updater.on('error', error => {
    updater.lastResult = 'error';
    console.error('update:', error && error.message);
  });
  return updater;
}

async function check() {
  if (!configured()) {
    return { checked: false, reason: baseUrl() ? 'public-key-missing' : 'not-configured' };
  }
  const manifest = await verifyFeed();
  if (!manifest) return { checked: false, reason: 'signature-invalid', detail: feedError };
  const service = load();
  if (!service) return { checked: false, reason: app.isPackaged ? 'updater-unavailable' : 'dev' };
  try {
    const result = await service.checkForUpdates();
    return {
      checked: true,
      available: Boolean(result?.updateInfo),
      version: result?.updateInfo?.version || manifest.version
    };
  } catch {
    return { checked: true, available: false, reason: 'unavailable' };
  }
}

async function download() {
  if (!await verifyFeed()) return false;
  const service = load();
  if (!service) return false;
  await service.downloadUpdate();
  return true;
}

async function install() {
  if (!await verifyFeed()) return false;
  const service = load();
  if (!service || service.lastResult !== 'downloaded') return false;
  service.quitAndInstall(false, true);
  return true;
}

module.exports = { configured, check, download, install, verifyFeed };
