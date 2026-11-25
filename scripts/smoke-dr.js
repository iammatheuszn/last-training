'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { open } = require('../server/db');
const { seed } = require('../server/scripts/seed');
const { verify: verifyPassword } = require('../server/security/passwords');
const { createHealthService } = require('../server/services/health');
const { exportAudit } = require('./export-audit');
const backup = require('./backup');

const identity = 'dr@lasttraining.local';
const password = 'DrDrill2026!';
const auditEvent = 'dr_drill_marker';

async function runChecks() {
  const checks = [];
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-dr-smoke-'));
  const dbPath = path.join(temp, 'server', 'data', 'last-training.db');
  const backupDir = path.join(temp, 'server', 'backups');
  const auditOut = path.join(temp, 'audit.jsonl');
  const deviceId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const hwid = `DR-HWID-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  const ip = '198.51.100.77';
  const refreshHash = crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex');
  let accountId;
  let failed = false;

  async function step(name, action) {
    try {
      const detail = await action();
      checks.push({ name, status: 'ok', detail: detail || '' });
      return detail;
    } catch (error) {
      checks.push({ name, status: 'fail', detail: error?.message || String(error) });
      failed = true;
      throw error;
    }
  }

  try {
    await step('banco semeado', () => {
      const originalLog = console.log;
      console.log = () => {};
      try {
        seed({ dbPath, identity, password, display: 'Dr Olivia', plan: 'pro', status: 'active' });
      } finally {
        console.log = originalLog;
      }
      const db = open(dbPath);
      try {
        accountId = db.prepare('SELECT id FROM accounts WHERE email = ? COLLATE NOCASE').get(identity)?.id;
        if (!accountId) throw new Error('conta não criada');
        const now = new Date().toISOString();
        db.prepare(
          'INSERT INTO devices (id, account_id, name, ip, hwid, created_at, last_seen, revoked) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
        ).run(deviceId, accountId, 'Dr Device', ip, hwid, now, now);
        db.prepare(
          'INSERT INTO sessions (id, account_id, device_id, refresh_hash, expires_at, revoked, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
        ).run(sessionId, accountId, deviceId, refreshHash, Date.now() + 86400000, now);
        db.prepare(
          'INSERT INTO audit (at, account_id, event, detail, ip) VALUES (?, ?, ?, ?, ?)'
        ).run(now, accountId, auditEvent, 'restore drill', ip);
      } finally {
        db.close();
      }
      return accountId;
    });

    let backupDirCreated;
    await step('backup criado', () => {
      const result = backup.create({ dbPath, dir: backupDir, label: 'dr-drill' });
      if (!result.ok || !fs.existsSync(path.join(result.dir, 'last-training.db'))) throw new Error('backup ausente');
      backupDirCreated = result.dir;
      return path.relative(temp, result.dir);
    });

    const verified = await step('backup verificado', () => {
      const result = backup.verify({ dbPath, dir: backupDir, file: backupDirCreated });
      if (!result.ok || result.integrity !== 'ok') throw new Error('backup inválido');
      return `${result.files.length} arquivo(s) / integrity ok`;
    });

    await step('proteção pré-restore', () => {
      backup.restore({ dbPath, dir: backupDir, file: backupDirCreated });
      const entries = backup.list({ dbPath, dir: backupDir });
      if (!entries.some(entry => entry.label === 'pre-restore')) throw new Error('backup pré-restore não criado');
      return 'pre-restore preservado';
    });

    await step('perda simulada', () => {
      for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(file, { force: true });
      if (fs.existsSync(dbPath)) throw new Error('banco ainda presente');
      return 'db, wal e shm removidos';
    });

    await step('restore', () => {
      const result = backup.restore({ dbPath, dir: backupDir, file: backupDirCreated, force: true });
      if (!result.ok || !fs.existsSync(dbPath)) throw new Error('restore falhou');
      if (result.restoredFrom !== backupDirCreated) throw new Error('restore usou backup errado');
      return path.relative(temp, result.restoredFrom);
    });

    await step('dados restaurados', () => {
      const db = open(dbPath);
      try {
        const account = db.prepare('SELECT id, email, display FROM accounts WHERE email = ? COLLATE NOCASE').get(identity);
        const license = db.prepare('SELECT plan, status FROM licenses WHERE account_id = ?').get(accountId);
        const device = db.prepare('SELECT ip, hwid FROM devices WHERE id = ?').get(deviceId);
        const session = db.prepare('SELECT refresh_hash FROM sessions WHERE id = ?').get(sessionId);
        const audit = db.prepare('SELECT event FROM audit WHERE event = ? LIMIT 1').get(auditEvent);
        if (!account || !license || !device || !session || !audit) throw new Error('registro ausente após restore');
        if (license.status !== 'active' || license.plan !== 'pro') throw new Error('licença divergente');
        if (device.hwid !== hwid || device.ip !== ip) throw new Error('device divergente');
        if (session.refresh_hash !== refreshHash) throw new Error('sessão divergente');
        if (!verifyPassword(password, db.prepare('SELECT password_hash FROM accounts WHERE id = ?').get(accountId).password_hash)) {
          throw new Error('senha não valida após restore');
        }
      } finally {
        db.close();
      }
      return 'conta, licença, device, sessão, auditoria e senha ok';
    });

    await step('health após restore', () => {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const report = createHealthService({
          db,
          config: {
            environment: 'test',
            ephemeralSecret: false,
            accessTtlSeconds: 900,
            refreshTtlDays: 30,
            tlsTerminated: true
          }
        }).report();
        if (report.status === 'fail' || !report.checks.database.ok) throw new Error(`health ${report.status}`);
        if (report.counts.accounts !== 1 || report.counts.devices !== 1 || report.counts.sessions !== 1) {
          throw new Error('contagens divergentes');
        }
        return `${report.status} / ${report.counts.accounts} conta / ${report.counts.audit} audit`;
      } finally {
        db.close();
      }
    });

    await step('export de auditoria', () => {
      const result = exportAudit({ db: dbPath, format: 'jsonl', out: auditOut, event: auditEvent });
      const content = fs.readFileSync(auditOut, 'utf8');
      if (result.count !== 1 || !content.includes(auditEvent)) throw new Error('evento não exportado');
      return `${result.count} evento / ${result.format}`;
    });

    return {
      ok: !failed,
      status: failed ? 'fail' : 'ok',
      backup: verified,
      checks
    };
  } catch {
    return { ok: false, status: 'fail', checks };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
}

if (require.main === module) {
  runChecks()
    .then(report => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
    })
    .catch(error => {
      console.error(error?.message || String(error));
      process.exit(1);
    });
}

module.exports = { runChecks };
