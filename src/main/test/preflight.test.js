'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { preflight } = require('../../../scripts/preflight');

const KEYS = [
  'LT_ENV', 'LT_DB_PATH', 'LT_BACKUP_DIR', 'LT_TLS_TERMINATED',
  'LT_UPDATE_URL', 'LT_UPDATE_PUBLIC_KEY', 'AUTH_JWT_SECRET',
  'LT_PUBLIC_ORIGIN', 'LT_BASE_URL', 'LT_AUTH_API_BASE_URL'
];

function isolated(t, lines) {
  const saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  t.after(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-preflight-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const envFile = path.join(dir, '.env');
  fs.writeFileSync(envFile, lines(dir).join('\n'));
  return { dir, envFile };
}

test('preflight aprovado com ambiente-devel e banco íntegro', async t => {
  const { dir, envFile } = isolated(t, folder => [
    'LT_ENV=development',
    `LT_DB_PATH=${path.join(folder, 'test.db')}`,
    `LT_BACKUP_DIR=${path.join(folder, 'backups')}`,
    'LT_TLS_TERMINATED=true'
  ]);
  const db = new DatabaseSync(path.join(dir, 'test.db'));
  db.exec('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY)');
  db.close();

  const report = await preflight({ env: envFile, skipBuild: true, skipNetwork: true });
  assert.equal(report.ok, true);
  assert.ok(report.checks.find(item => item.name === 'banco').status === 'ok');
  assert.ok(report.checks.find(item => item.name === 'config').status === 'ok');
});

test('preflight reprova produção sem segredo e origem HTTPS', async t => {
  const { dir, envFile } = isolated(t, folder => [
    'LT_ENV=production',
    `LT_DB_PATH=${path.join(folder, 'test.db')}`,
    `LT_BACKUP_DIR=${path.join(folder, 'backups')}`,
    'LT_TLS_TERMINATED=true'
  ]);
  const db = new DatabaseSync(path.join(dir, 'test.db'));
  db.exec('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY)');
  db.close();

  const report = await preflight({ env: envFile, skipBuild: true, skipNetwork: true });
  assert.equal(report.ok, false);
  assert.equal(report.environment, 'production');
  assert.ok(report.checks.some(item => item.name === 'config' && item.status === 'fail'));
});
