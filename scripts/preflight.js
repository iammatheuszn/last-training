'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { applyEnvFile, validateEnvironment, mask } = require('../server/env');
const { verify } = require('../src/main/security/integrity');

const root = path.join(__dirname, '..');

function parseArgs(argv) {
  const args = { checks: [] };
  for (const token of argv) {
    if (token === '--production') args.production = true;
    else if (token === '--json') args.json = true;
    else if (token === '--skip-network') args.skipNetwork = true;
    else if (token === '--skip-build') args.skipBuild = true;
    else if (token.startsWith('--env=')) args.env = token.slice(6);
    else if (token.startsWith('--url=')) args.url = token.slice(6);
  }
  return args;
}

function add(checks, name, status, detail) {
  checks.push({ name, status, detail });
}

function checkNode(checks) {
  const major = Number(process.versions.node.split('.')[0]);
  add(checks, 'runtime', major >= 20 ? 'ok' : 'fail', `Node ${process.versions.node}`);
}

function checkBuild(checks, skip) {
  if (skip) return add(checks, 'build', 'skip', 'ignorado por --skip-build');
  const dist = path.join(root, 'dist');
  const integrity = verify(dist);
  add(
    checks,
    'integridade',
    integrity.ok ? 'ok' : 'fail',
    integrity.ok ? `${integrity.checked} arquivos verificados` : `${integrity.reason}`
  );
  const admin = path.join(root, 'server', 'admin', 'dist', 'index.html');
  add(checks, 'painel admin', fs.existsSync(admin) ? 'ok' : 'fail', path.relative(root, admin));
}

function checkDatabase(checks, env) {
  const file = path.resolve(env.LT_DB_PATH || path.join(root, 'server', 'data', 'last-training.db'));
  if (!fs.existsSync(file)) {
    add(checks, 'banco', env.LT_ENV === 'production' ? 'fail' : 'warn', `ausente: ${path.relative(root, file)}`);
    return;
  }
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    let result;
    try {
      const rows = db.prepare('PRAGMA quick_check').all();
      result = rows.length === 1 && String(rows[0].quick_check).toLowerCase() === 'ok';
    } finally {
      db.close();
    }
    add(checks, 'banco', result ? 'ok' : 'fail', path.relative(root, file));
  } catch (error) {
    add(checks, 'banco', 'fail', error.message);
  }
}

function checkTls(checks, env) {
  const local = Boolean(env.LT_TLS_KEY && env.LT_TLS_CERT);
  const terminated = String(env.LT_TLS_TERMINATED || '').toLowerCase() === 'true';
  if (local) {
    const ok = fs.existsSync(env.LT_TLS_KEY) && fs.existsSync(env.LT_TLS_CERT);
    add(checks, 'tls', ok ? 'ok' : 'fail', ok ? 'certificado local' : 'arquivos de certificado ausentes');
  } else if (terminated) {
    add(checks, 'tls', 'ok', 'TLS terminado no proxy');
  } else {
    add(checks, 'tls', env.LT_ENV === 'production' ? 'fail' : 'warn', 'sem TLS local nem proxy configurado');
  }
}

function checkUpdates(checks, env) {
  const url = String(env.LT_UPDATE_URL || '').trim();
  const key = String(env.LT_UPDATE_PUBLIC_KEY || '').trim();
  if (!url && !key) return add(checks, 'updates', 'warn', 'feed desativado');
  if (!/^https:\/\//i.test(url)) return add(checks, 'updates', 'fail', 'LT_UPDATE_URL precisa ser HTTPS');
  if (!key) return add(checks, 'updates', 'fail', 'LT_UPDATE_PUBLIC_KEY ausente');
  try {
    require('../src/main/update/signature').publicKeyFrom(key);
    add(checks, 'updates', 'ok', 'chave pública Ed25519 válida');
  } catch (error) {
    add(checks, 'updates', 'fail', error.message);
  }
}

function checkBackup(checks, env) {
  const dir = path.resolve(env.LT_BACKUP_DIR || path.join(root, 'server', 'backups'));
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.accessSync(dir, fs.constants.W_OK);
    add(checks, 'backup', 'ok', path.relative(root, dir));
  } catch (error) {
    add(checks, 'backup', 'fail', error.message);
  }
}

async function checkHealth(checks, env, args) {
  const target = args.url || (env.LT_ENV === 'production' ? env.LT_PUBLIC_ORIGIN : '');
  if (!target) return add(checks, 'health', 'skip', 'sem URL informada');
  if (args.skipNetwork) return add(checks, 'health', 'skip', 'ignorado por --skip-network');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let response;
    try {
      response = await fetch(`${String(target).replace(/\/+$/, '')}/health`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    const payload = await response.json();
    const healthy = response.ok && payload?.ok === true && payload?.status !== 'fail';
    add(checks, 'health', healthy ? 'ok' : 'fail', `HTTP ${response.status} / ${payload?.status || 'sem status'}`);
  } catch (error) {
    add(checks, 'health', 'fail', error?.name === 'AbortError' ? 'timeout' : error.message);
  }
}

async function preflight(args) {
  applyEnvFile(args.env ? path.resolve(args.env) : path.join(root, '.env'));
  if (args.production) process.env.LT_ENV = 'production';
  const env = { ...process.env };
  const checks = [];

  checkNode(checks);
  const issues = validateEnvironment(env);
  for (const issue of issues) add(checks, 'config', 'fail', issue);
  if (!issues.length) add(checks, 'config', 'ok', env.LT_ENV || 'development');

  checkBuild(checks, args.skipBuild);
  checkDatabase(checks, env);
  checkTls(checks, env);
  checkUpdates(checks, env);
  checkBackup(checks, env);
  await checkHealth(checks, env, args);

  const failures = checks.filter(item => item.status === 'fail');
  const warnings = checks.filter(item => item.status === 'warn');
  return {
    ok: failures.length === 0,
    status: failures.length ? 'fail' : warnings.length ? 'warn' : 'ok',
    environment: env.LT_ENV || 'development',
    endpoint: env.LT_AUTH_API_BASE_URL || env.LT_BASE_URL || '',
    publicOrigin: env.LT_PUBLIC_ORIGIN || '',
    database: env.LT_DB_PATH || '',
    jwtSecret: mask(env.AUTH_JWT_SECRET),
    checks
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await preflight(args);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { preflight, parseArgs };
