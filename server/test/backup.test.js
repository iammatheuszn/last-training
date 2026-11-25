'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { seed } = require('../scripts/seed');
const backup = require('../../scripts/backup');
const { exportAudit } = require('../../scripts/export-audit');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-backup-test-'));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch {  }
  });
  return {
    dbPath: path.join(dir, 'last-training.db'),
    dir: path.join(dir, 'backups')
  };
}

function auditCount(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare('SELECT COUNT(*) AS total FROM audit').get().total;
  } finally {
    db.close();
  }
}

test('backup cria, verifica, lista e restaura banco com integridade', t => {
  const { dbPath, dir } = setup(t);
  seed({ dbPath, identity: 'backup@example.com', password: 'senha-forte-backup', display: 'Backup', plan: 'pro', status: 'active' });

  const db = new DatabaseSync(dbPath);
  db.prepare('INSERT INTO audit (at, account_id, event, detail, ip) VALUES (?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), null, 'before_backup', '', '127.0.0.1');
  db.close();

  const created = backup.create({ dbPath, dir, keep: 3, label: 'pre-test' });
  assert.equal(created.ok, true);
  assert.ok(created.files.includes('last-training.db'));

  const verified = backup.verify({ dir, file: created.dir });
  assert.equal(verified.ok, true);
  assert.equal(verified.integrity, 'ok');

  const listed = backup.list({ dir, dbPath, keep: 3 });
  assert.equal(listed.length, 1);

  const after = new DatabaseSync(dbPath);
  after.prepare('INSERT INTO audit (at, account_id, event, detail, ip) VALUES (?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), null, 'after_backup', '', '127.0.0.1');
  after.close();
  assert.equal(auditCount(dbPath), 2);

  const restored = backup.restore({ dbPath, dir, file: created.dir, force: true });
  assert.equal(restored.ok, true);
  assert.equal(auditCount(dbPath), 1);
});

test('exportação de auditoria filtra evento e grava JSONL', t => {
  const { dbPath } = setup(t);
  seed({ dbPath, identity: 'audit@example.com', password: 'senha-forte-audit', display: 'Audit', plan: 'pro', status: 'active' });
  const db = new DatabaseSync(dbPath);
  db.prepare('INSERT INTO audit (at, account_id, event, detail, ip) VALUES (?, ?, ?, ?, ?)')
    .run('2026-01-01T00:00:00.000Z', null, 'login_success', 'device-1', '198.51.100.2');
  db.prepare('INSERT INTO audit (at, account_id, event, detail, ip) VALUES (?, ?, ?, ?, ?)')
    .run('2026-01-01T00:01:00.000Z', null, 'login_failed', '', '198.51.100.3');
  db.close();

  const out = path.join(path.dirname(dbPath), 'audit.jsonl');
  const result = exportAudit({ db: dbPath, event: 'login_success', out, format: 'jsonl' });
  assert.equal(result.count, 1);
  const content = fs.readFileSync(out, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(content[0].event, 'login_success');
  assert.equal(content[0].ip, '198.51.100.2');
});
