'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const store = require('../settings/store');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-settings-'));
const file = path.join(dir, 'lt.settings.v1.json');

test('configuração começa com padrões limitados', () => {
  const loaded = store.configureSettings(file);
  assert.equal(loaded.overlayEnabled, false);
  assert.equal(loaded.overlayMode, 'cursor');
  assert.equal(loaded.sensitivity, 52);
  assert.equal(loaded.overlayThickness, 35);
});

test('canonicalização limita números e valida modo', () => {
  const clean = store.canonicalize({
    sensitivity: 999,
    targetSize: -20,
    crosshairOpacity: '80',
    overlayEnabled: 'yes',
    overlayMode: 'admin',
    overlayGap: 44
  });
  assert.equal(clean.sensitivity, 100);
  assert.equal(clean.targetSize, 0);
  assert.equal(clean.crosshairOpacity, 80);
  assert.equal(clean.overlayEnabled, false);
  assert.equal(clean.overlayMode, 'cursor');
  assert.equal(clean.overlayGap, 44);
});

test('atualização rejeita chave desconhecida e aplica patch permitido', () => {
  assert.equal(store.updateSettings({ admin: true }).ok, false);
  const result = store.updateSettings({
    overlayEnabled: true,
    overlayMode: 'center',
    overlaySize: 1000,
    overlayGap: 100,
    overlayThickness: 100
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.overlayEnabled, true);
  assert.equal(result.data.overlayMode, 'center');
  assert.equal(result.data.overlaySize, 100);
});

test('overlay config só aparece com sessão autenticada', () => {
  const settings = store.getSettings();
  const locked = store.overlayConfig(settings, false);
  const unlocked = store.overlayConfig(settings, true);
  assert.equal(locked.enabled, false);
  assert.equal(unlocked.enabled, true);
  assert.equal(unlocked.mode, 'center');
  assert.equal(unlocked.size, 48);
  assert.equal(unlocked.gap, 12);
  assert.equal(unlocked.thickness, 4);
  assert.equal(unlocked.opacity, 0.8);
});

test('configuração sobrevive a recarga do arquivo', () => {
  assert.ok(fs.existsSync(file));
  store.configureSettings(file);
  const settings = store.getSettings();
  assert.equal(settings.overlayEnabled, true);
  assert.equal(settings.overlayMode, 'center');
});
