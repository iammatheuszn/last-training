'use strict';

function record(db, event, details = {}) {
  db.prepare(
    'INSERT INTO audit (at, account_id, event, detail, ip) VALUES (?, ?, ?, ?, ?)'
  ).run(
    new Date().toISOString(),
    details.accountId || null,
    event,
    String(details.detail || '').slice(0, 500),
    String(details.ip || '').slice(0, 64)
  );
}

module.exports = { record };
