'use strict';

const fs = require('node:fs');

const ENV_KEYS = Object.freeze([
  'LT_ENV',
  'LT_SERVER_HOST',
  'LT_SERVER_PORT',
  'LT_BASE_URL',
  'LT_PUBLIC_ORIGIN',
  'LT_DB_PATH',
  'AUTH_JWT_SECRET',
  'LT_TLS_KEY',
  'LT_TLS_CERT',
  'LT_TLS_TERMINATED',
  'LT_TRUST_PROXY',
  'LT_TRUSTED_PROXIES',
  'LT_ACCESS_TTL',
  'LT_REFRESH_TTL_DAYS',
  'LT_MAX_DEVICES',
  'LT_LOGIN_MAX_FAILURES',
  'LT_LOGIN_WINDOW_MS',
  'LT_LOGIN_LOCK_MS',
  'LT_GLOBAL_MAX_PER_MINUTE',
  'LT_REQUEST_ID_TTL_MS',
  'LT_ADMIN_TTL',
  'LT_ADMIN_LOGIN_MAX_FAILURES',
  'LT_ADMIN_LOGIN_WINDOW_MS',
  'LT_ADMIN_LOGIN_LOCK_MS',
  'LT_ADMIN_EMAIL',
  'LT_ADMIN_PASSWORD',
  'LT_ADMIN_DISPLAY',
  'LT_SEED_EMAIL',
  'LT_SEED_PASSWORD',
  'LT_LOCAL_DB_PATH',
  'LT_AUTH_API_BASE_URL',
  'LT_UPDATE_URL',
  'LT_UPDATE_PUBLIC_KEY',
  'LT_UPDATE_PRIVATE_KEY',
  'LT_UPDATE_PRIVATE_KEY_PATH',
  'LT_BACKUP_DIR',
  'LT_BACKUP_RETENTION',
  'LT_LOG_DIR',
  'NODE_EXTRA_CA_CERTS'
]);

function parseEnvFile(source) {
  const values = {};
  for (const rawLine of String(source).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
      if (rawLine.includes('"')) value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    values[match[1]] = value;
  }
  return values;
}

function readEnvFile(file) {
  if (!file || !fs.existsSync(file)) return {};
  return parseEnvFile(fs.readFileSync(file, 'utf8'));
}

function applyEnvFile(file, target = process.env) {
  const values = readEnvFile(file);
  for (const [key, value] of Object.entries(values)) {
    if (target[key] === undefined) target[key] = value;
  }
  return values;
}

function isUrl(value, protocol) {
  try {
    const url = new URL(String(value));
    if (protocol && url.protocol !== protocol) return false;
    return Boolean(url.hostname);
  } catch {
    return false;
  }
}

function hasFile(value) {
  return Boolean(value) && fs.existsSync(String(value));
}

function trustedList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function validateEnvironment(input = process.env, options = {}) {
  const env = { ...input, ...(options.overrides || {}) };
  const mode = env.LT_ENV || options.mode || 'development';
  const issues = [];

  if (!['development', 'production'].includes(mode)) {
    issues.push(`LT_ENV deve ser development ou production, recebeu ${mode}.`);
  }

  for (const key of ['LT_PUBLIC_ORIGIN', 'LT_BASE_URL', 'LT_AUTH_API_BASE_URL', 'LT_UPDATE_URL']) {
    if (env[key] && !isUrl(env[key], 'https:')) {
      issues.push(`${key} precisa ser uma URL HTTPS válida.`);
    }
  }

  if (mode !== 'production') return issues;

  if (!env.AUTH_JWT_SECRET || String(env.AUTH_JWT_SECRET).length < 32) {
    issues.push('AUTH_JWT_SECRET é obrigatório em produção com pelo menos 32 caracteres.');
  }
  if (!env.LT_PUBLIC_ORIGIN || !isUrl(env.LT_PUBLIC_ORIGIN, 'https:')) {
    issues.push('LT_PUBLIC_ORIGIN é obrigatório em produção com origem HTTPS exata.');
  } else {
    const origin = new URL(env.LT_PUBLIC_ORIGIN);
    if (origin.pathname !== '/' || origin.search || origin.hash) {
      issues.push('LT_PUBLIC_ORIGIN não pode ter caminho, query ou fragmento.');
    }
  }
  if (!env.LT_DB_PATH) {
    issues.push('LT_DB_PATH é obrigatório em produção para evitar banco efêmero.');
  }

  const localTls = env.LT_TLS_KEY && env.LT_TLS_CERT;
  if (localTls && (!hasFile(env.LT_TLS_KEY) || !hasFile(env.LT_TLS_CERT))) {
    issues.push('LT_TLS_KEY e LT_TLS_CERT precisam apontar para arquivos existentes.');
  }
  const terminated = String(env.LT_TLS_TERMINATED || '').toLowerCase() === 'true';
  if (!localTls && !terminated) {
    issues.push('Produção exige LT_TLS_KEY/LT_TLS_CERT ou LT_TLS_TERMINATED=true com proxy HTTPS.');
  }

  if (String(env.LT_TRUST_PROXY || '').toLowerCase() === 'true' && !trustedList(env.LT_TRUSTED_PROXIES).length) {
    issues.push('LT_TRUSTED_PROXIES é obrigatório quando LT_TRUST_PROXY=true.');
  }

  return issues;
}

function assertEnvironment(input = process.env, options = {}) {
  const issues = validateEnvironment(input, options);
  if (issues.length) {
    const error = new Error(`Configuração inválida:\n- ${issues.join('\n- ')}`);
    error.code = 'CONFIG_INVALID';
    error.issues = issues;
    throw error;
  }
  return true;
}

function mask(value) {
  const text = String(value ?? '');
  if (!text) return '';
  if (text.length <= 8) return '*'.repeat(text.length);
  return `${text.slice(0, 3)}…${text.slice(-3)}`;
}

module.exports = {
  ENV_KEYS,
  parseEnvFile,
  readEnvFile,
  applyEnvFile,
  validateEnvironment,
  assertEnvironment,
  trustedList,
  mask
};
