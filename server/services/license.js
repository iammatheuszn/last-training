'use strict';

const ACTIVE = 'active';

function effectiveStatus(row) {
  if (!row) return 'inactive';
  if (row.status !== ACTIVE) return row.status;
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return 'expired';
  return ACTIVE;
}

function summary(db, accountId) {
  const row = db.prepare(
    'SELECT plan, status, expires_at, features, updated_at FROM licenses WHERE account_id = ?'
  ).get(accountId);
  const status = effectiveStatus(row);

  let features = [];
  if (status === ACTIVE && row) {
    try {
      const parsed = JSON.parse(row.features);
      if (Array.isArray(parsed)) features = parsed.filter(item => typeof item === 'string');
    } catch {
      features = [];
    }
  }

  return {
    status,
    plan: row ? row.plan : 'none',
    expiresAt: row && row.expires_at ? row.expires_at : null,
    features,
    updatedAt: row ? row.updated_at : null
  };
}

function assertActive(license) {
  if (license.status === ACTIVE) return;
  const error = new Error('Licença não autorizada.');
  error.code = `LICENSE_${license.status.toUpperCase()}`;
  error.status = 403;
  throw error;
}

module.exports = { effectiveStatus, summary, assertActive };
