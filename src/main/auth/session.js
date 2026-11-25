'use strict';

const fs = require('node:fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const FILENAME = 'session.lt';

const location = () => path.join(app.getPath('userData'), FILENAME);

function load() {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const file = location();
  if (!fs.existsSync(file)) return null;
  try {
    const clear = safeStorage.decryptString(fs.readFileSync(file));
    const data = JSON.parse(clear);
    if (data?.v !== 2) return null;
    if (typeof data.accessToken !== 'string' || !data.accessToken) return null;
    if (typeof data.refreshToken !== 'string' || !data.refreshToken) return null;
    if (typeof data.deviceId !== 'string' || !data.deviceId) return null;
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      deviceId: data.deviceId,
      savedAt: Number(data.savedAt) || 0
    };
  } catch {
    return null;
  }
}

function save(session) {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const payload = JSON.stringify({
    v: 2,
    accessToken: session.token,
    refreshToken: session.refreshToken,
    deviceId: session.deviceId,
    savedAt: Date.now()
  });
  try {
    fs.writeFileSync(location(), safeStorage.encryptString(payload), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function clear() {
  try {
    fs.rmSync(location(), { force: true });
  } catch {
  }
}

module.exports = { load, save, clear, encrypted: () => safeStorage.isEncryptionAvailable() };
