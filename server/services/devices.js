'use strict';

const { record } = require('./audit');

function fail(code, status = 403) {
  const error = new Error('Dispositivo não autorizado.');
  error.code = code;
  error.status = status;
  return error;
}

function registerOrTouch(db, accountId, device, maxDevices, context = {}) {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM devices WHERE id = ?').get(device.id);

  if (existing) {
    if (existing.account_id !== accountId) throw fail('DEVICE_CONFLICT');
    if (existing.revoked) {
      record(db, 'device_revoked_attempt', { accountId, detail: device.id, ip: context.ip });
      throw fail('DEVICE_REVOKED');
    }
    db.prepare(
      'UPDATE devices SET name = ?, ip = ?, hwid = ?, last_seen = ? WHERE id = ?'
    ).run(device.name, context.ip || '', device.hwid || device.id, now, device.id);
    return;
  }

  const active = db.prepare(
    'SELECT COUNT(*) AS total FROM devices WHERE account_id = ? AND revoked = 0'
  ).get(accountId).total;

  if (active >= maxDevices) {
    record(db, 'device_limit', { accountId, detail: device.id, ip: context.ip });
    throw fail('DEVICE_LIMIT');
  }

  db.prepare(
    `INSERT INTO devices (id, account_id, name, ip, hwid, created_at, last_seen, revoked)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(device.id, accountId, device.name, context.ip || '', device.hwid || device.id, now, now);
  record(db, 'device_registered', { accountId, detail: device.id, ip: context.ip });
}

module.exports = { registerOrTouch };
