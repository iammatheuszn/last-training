'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  sensitivity: 52,
  targetSize: 68,
  crosshairOpacity: 80,
  feedback: 45,
  overlayEnabled: false,
  overlayMode: 'cursor',
  overlaySize: 55,
  overlayGap: 38,
  overlayThickness: 35
});

const PERCENT_KEYS = Object.freeze([
  'sensitivity',
  'targetSize',
  'crosshairOpacity',
  'feedback',
  'overlaySize',
  'overlayGap',
  'overlayThickness'
]);

const MODES = Object.freeze(['cursor', 'center']);
const listeners = new Set();

let config = { ...DEFAULTS };
let filePath = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function percent(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(clamp(parsed, 0, 100));
}

function canonicalize(raw) {
  const next = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return next;

  for (const key of PERCENT_KEYS) {
    next[key] = percent(raw[key], DEFAULTS[key]);
  }
  if (typeof raw.overlayEnabled === 'boolean') next.overlayEnabled = raw.overlayEnabled;
  if (MODES.includes(raw.overlayMode)) next.overlayMode = raw.overlayMode;
  return next;
}

function emit() {
  for (const listener of listeners) {
    try {
      listener({ ...config });
    } catch {
    }
  }
}

function configureSettings(storePath) {
  filePath = storePath;
  let stored = {};
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed;
  } catch {
    stored = {};
  }
  config = canonicalize(stored);
  return { ...config };
}

function settingsPath(userData) {
  return filePath || path.join(userData, 'lt.settings.v1.json');
}

function persist() {
  if (!filePath) return;
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, filePath);
}

function getSettings() {
  return { ...config };
}

function updateSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, error: 'INVALID_SETTINGS' };
  }

  const next = canonicalize({ ...config, ...patch });
  const allowed = new Set([...PERCENT_KEYS, 'overlayEnabled', 'overlayMode']);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) return { ok: false, error: 'INVALID_SETTINGS' };
  }

  config = next;
  try {
    persist();
  } catch {
  }
  emit();
  return { ok: true, data: { ...config } };
}

function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function overlayConfig(settings, authenticated) {
  const source = canonicalize(settings);
  return {
    enabled: Boolean(authenticated && source.overlayEnabled),
    mode: source.overlayMode,
    opacity: source.crosshairOpacity / 100,
    size: 14 + Math.round((source.overlaySize / 100) * 34),
    gap: Math.round((source.overlayGap / 100) * 12),
    thickness: 1 + Math.round((source.overlayThickness / 100) * 3)
  };
}

function defaultSettings() {
  return { ...DEFAULTS };
}

module.exports = {
  DEFAULTS,
  configureSettings,
  settingsPath,
  getSettings,
  updateSettings,
  subscribe,
  overlayConfig,
  canonicalize,
  defaultSettings
};
