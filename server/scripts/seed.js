'use strict';

const crypto = require('node:crypto');
const { createConfig } = require('../config');
const { open } = require('../db');
const { hash } = require('../security/passwords');

function now() {
  return new Date().toISOString();
}

function seed(options = {}) {
  const config = createConfig(options);
  const db = open(config.dbPath);
  const identity = options.identity || process.env.LT_SEED_EMAIL || 'olivia@example.com';
  const password = options.password || process.env.LT_SEED_PASSWORD || '';

  if (!password) throw new Error('Defina LT_SEED_PASSWORD ou use --password.');

  const id = options.id || crypto.randomUUID();
  const existing = db.prepare('SELECT id FROM accounts WHERE email = ? COLLATE NOCASE').get(identity);

  if (existing) {
    db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hash(password), existing.id);
    console.log(`senha atualizada: ${identity}`);
  } else {
    db.prepare(
      'INSERT INTO accounts (id, email, display, password_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, identity, options.display || 'Olivia', hash(password), 'active', now());
    console.log(`conta criada: ${identity}`);
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
    existing ? existing.id : id,
    options.plan || 'pro',
    options.status || 'active',
    options.expiresAt || null,
    JSON.stringify(options.features || [
      'tracking', 'clicking', 'flick', 'switching', 'precision', 'speed',
      'crosshair_follow', 'crosshair_stability', 'crosshair_grid'
    ]),
    now()
  );

  console.log(`licença: ${options.status || 'active'} / ${options.plan || 'pro'}`);
  db.close();
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--email') options.identity = args[++i];
    if (args[i] === '--password') options.password = args[++i];
    if (args[i] === '--plan') options.plan = args[++i];
    if (args[i] === '--status') options.status = args[++i];
    if (args[i] === '--db') options.dbPath = args[++i];
  }
  try {
    seed(options);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { seed };
