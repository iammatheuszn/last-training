'use strict';

const crypto = require('node:crypto');
const { createConfig } = require('../config');
const { open } = require('../db');
const { hash } = require('../security/passwords');
const { email, text } = require('../security/validate');
const { record } = require('../services/audit');

const DEMO_ADMIN = Object.freeze({
  email: 'admin@lasttraining.local',
  password: 'LastTrainingAdmin2026!',
  display: 'Ian Matheus'
});

function now() {
  return new Date().toISOString();
}

function seedAdmin(options = {}) {
  const identity = options.identity || process.env.LT_ADMIN_EMAIL || '';
  const password = options.password || process.env.LT_ADMIN_PASSWORD || '';
  const display = options.display || process.env.LT_ADMIN_DISPLAY || 'Administrador';

  if (!email(identity)) throw new Error('Defina LT_ADMIN_EMAIL ou use --email com um e-mail válido.');
  if (!text(password, 10, 256)) throw new Error('Defina LT_ADMIN_PASSWORD ou use --password com ao menos 10 caracteres.');

  const config = createConfig(options);
  const db = open(config.dbPath);
  const normalized = identity.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM accounts WHERE email = ? COLLATE NOCASE').get(normalized);
  const id = existing ? existing.id : crypto.randomUUID();

  if (existing) {
    db.prepare(
      'UPDATE accounts SET display = ?, password_hash = ?, status = ?, role = ? WHERE id = ?'
    ).run(display.trim(), hash(password), 'active', 'admin', id);
    console.log(`administrador atualizado: ${normalized}`);
  } else {
    db.prepare(
      'INSERT INTO accounts (id, email, display, password_hash, status, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, normalized, display.trim(), hash(password), 'active', 'admin', now());
    console.log(`administrador criado: ${normalized}`);
  }

  db.prepare(
    `INSERT INTO licenses (account_id, plan, status, expires_at, features, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       plan = excluded.plan,
       status = excluded.status,
       expires_at = excluded.expires_at,
       features = excluded.features,
       updated_at = excluded.updated_at`
  ).run(
    id,
    options.plan || 'pro',
    'active',
    null,
    JSON.stringify([
      'tracking', 'clicking', 'flick', 'switching', 'precision', 'speed',
      'crosshair_follow', 'crosshair_stability', 'crosshair_grid'
    ]),
    now()
  );

  record(db, 'admin_bootstrap', { accountId: id, detail: normalized });
  db.close();
  return { id, email: normalized };
}

function ensureDemoAdmin(options = {}) {
  const environment = options.environment || process.env.LT_ENV || 'development';
  if (environment === 'production' && !options.dbPath) return null;

  const config = createConfig(options);
  const db = open(config.dbPath);
  const existing = db.prepare('SELECT id FROM accounts WHERE email = ? COLLATE NOCASE').get(DEMO_ADMIN.email);
  if (existing) {
    db.close();
    return { id: existing.id, email: DEMO_ADMIN.email, created: false };
  }

  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO accounts (id, email, display, password_hash, status, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, DEMO_ADMIN.email, DEMO_ADMIN.display, hash(DEMO_ADMIN.password), 'active', 'admin', now());
  db.prepare(
    `INSERT INTO licenses (account_id, plan, status, expires_at, features, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       plan = excluded.plan,
       status = excluded.status,
       expires_at = excluded.expires_at,
       features = excluded.features,
       updated_at = excluded.updated_at`
  ).run(
    id,
    options.plan || 'pro',
    'active',
    null,
    JSON.stringify([
      'tracking', 'clicking', 'flick', 'switching', 'precision', 'speed',
      'crosshair_follow', 'crosshair_stability', 'crosshair_grid'
    ]),
    now()
  );
  record(db, 'admin_bootstrap', { accountId: id, detail: DEMO_ADMIN.email });
  db.close();
  console.log(`conta administrativa de demonstração: ${DEMO_ADMIN.email}`);
  return { id, email: DEMO_ADMIN.email, created: true };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--email') options.identity = args[++i];
    if (args[i] === '--password') options.password = args[++i];
    if (args[i] === '--display') options.display = args[++i];
    if (args[i] === '--plan') options.plan = args[++i];
    if (args[i] === '--db') options.dbPath = args[++i];
  }
  try {
    seedAdmin(options);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { seedAdmin, ensureDemoAdmin, DEMO_ADMIN };
