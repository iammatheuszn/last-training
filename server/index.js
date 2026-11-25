'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createConfig } = require('./config');
const { open } = require('./db');
const { createAuthService } = require('./services/auth');
const { createAdminService } = require('./services/admin');
const { createAccountService } = require('./services/account');
const { createHealthService } = require('./services/health');
const { RateLimiter } = require('./security/ratelimit');
const { NonceGuard } = require('./security/nonce');
const { applyEnvFile } = require('./env');
const { ensureDemoAdmin } = require('./scripts/seed-admin');

if (require.main === module) {
  applyEnvFile(path.join(__dirname, '..', '.env'));
  ensureDemoAdmin();
}

const MAX_BODY = 16 * 1024;
const ADMIN_DIR = path.join(__dirname, 'admin');
const ADMIN_DIST_DIR = path.join(ADMIN_DIR, 'dist');
const ADMIN_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'"
].join('; ');

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js') || file.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.woff2')) return 'font/woff2';
  if (file.endsWith('.woff')) return 'font/woff';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function loadAdminFiles() {
  const files = new Map([
    ['/admin', { file: path.join(ADMIN_DIST_DIR, 'index.html'), type: 'text/html; charset=utf-8' }],
    ['/admin/', { file: path.join(ADMIN_DIST_DIR, 'index.html'), type: 'text/html; charset=utf-8' }],
    ['/admin/index.html', { file: path.join(ADMIN_DIST_DIR, 'index.html'), type: 'text/html; charset=utf-8' }],
    ['/admin/logo.png', { file: path.join(ADMIN_DIST_DIR, 'logo.png'), type: 'image/png' }]
  ]);

  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(ADMIN_DIST_DIR, '.vite', 'manifest.json'), 'utf8'));
  } catch {
    return files;
  }

  for (const entry of Object.values(manifest)) {
    const names = [
      entry.file,
      ...(Array.isArray(entry.css) ? entry.css : entry.css ? [entry.css] : []),
      ...(Array.isArray(entry.assets) ? entry.assets : [])
    ]
      .filter(name => typeof name === 'string' && name)
      .map(name => name.replace(/^\/+/, ''));
    for (const name of new Set(names)) {
      files.set(`/admin/${name}`, {
        file: path.join(ADMIN_DIST_DIR, name),
        type: contentType(name)
      });
    }
  }
  return files;
}

const ADMIN_FILES = loadAdminFiles();

function json(response, status, data) {
  const body = Buffer.from(JSON.stringify(data));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer'
  });
  response.end(body);
}

function serveAdmin(pathname, response) {
  const entry = ADMIN_FILES.get(pathname);
  if (!entry) return false;

  const file = path.resolve(entry.file);
  const root = `${path.resolve(ADMIN_DIST_DIR)}${path.sep}`;
  if (!file.startsWith(root)) {
    json(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } });
    return true;
  }

  let content;
  try {
    content = fs.readFileSync(file);
  } catch {
    json(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } });
    return true;
  }

  response.writeHead(200, {
    'content-type': entry.type,
    'content-length': content.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': ADMIN_CSP
  });
  response.end(content);
  return true;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject({ code: 'INVALID_JSON', status: 400 });
      }
    });
    request.on('error', () => reject({ code: 'INVALID_REQUEST', status: 400 }));
  });
}

function bearerOf(request) {
  const header = request.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

function normalizeIp(value) {
  return String(value || '').trim().replace(/^::ffff:/, '');
}

function looksLikeIp(value) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || /^[0-9a-f:]+$/i.test(value);
}

function clientIp(request, config) {
  const trusted = new Set(config.trustedProxies.map(normalizeIp));
  const remote = normalizeIp(request.socket.remoteAddress || 'unknown');
  if (!config.trustProxy || !trusted.has(remote)) return remote;

  const chain = String(request.headers['x-forwarded-for'] || '')
    .split(',')
    .map(normalizeIp)
    .filter(Boolean);
  if (!chain.length) return remote;

  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (looksLikeIp(chain[index]) && !trusted.has(chain[index])) return chain[index];
  }
  return looksLikeIp(chain[0]) ? chain[0] : remote;
}

function originAllowed(request, config) {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (config.publicOrigin) return origin === config.publicOrigin;

  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol) &&
      parsed.host === (request.headers.host || '');
  } catch {
    return false;
  }
}

function errorPayload(error) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  const code = error.code || 'INTERNAL_ERROR';
  const message =
    status === 500
      ? 'Erro interno do serviço.'
      : error.message || 'Falha na solicitação.';
  return { status, body: { ok: false, error: { code, message } } };
}

function createApp(options = {}) {
  const config = createConfig(options);
  const db = open(config.dbPath);
  const limiter = new RateLimiter();
  const nonces = new NonceGuard(config.requestIdTtlMs);
  const auth = createAuthService({ db, config, limiter, nonces });
  const admin = createAdminService({ db, config, limiter, nonces });
  const account = createAccountService({ db, config, limiter });
  const health = createHealthService({ db, config });

  const routes = Object.freeze({
    LOGIN: '/v1/auth/login',
    REFRESH: '/v1/auth/refresh',
    VALIDATE: '/v1/auth/validate',
    LICENSE: '/v1/license/check',
    LOGOUT: '/v1/auth/logout',
    ADMIN_LOGIN: '/v1/admin/login',
    ADMIN_ACCOUNTS: '/v1/admin/accounts',
    ADMIN_ACCOUNT_CREATE: '/v1/admin/accounts/create',
    ADMIN_LICENSE: '/v1/admin/license',
    ADMIN_ACCOUNT_STATUS: '/v1/admin/account-status',
    ADMIN_DEVICES: '/v1/admin/devices',
    ADMIN_SESSIONS: '/v1/admin/sessions',
    ADMIN_DEVICE_REVOKE: '/v1/admin/devices/revoke',
    ADMIN_SESSIONS_REVOKE: '/v1/admin/sessions/revoke',
    ADMIN_PASSWORD_RESET: '/v1/admin/password-reset',
    ADMIN_AUDIT: '/v1/admin/audit',
    ACCOUNT_SUMMARY: '/v1/account/summary',
    ACCOUNT_DEVICES: '/v1/account/devices',
    ACCOUNT_SESSIONS: '/v1/account/sessions',
    ACCOUNT_DEVICE_REVOKE: '/v1/account/devices/revoke',
    ACCOUNT_SESSION_REVOKE: '/v1/account/sessions/revoke',
    ACCOUNT_SESSIONS_REVOKE: '/v1/account/sessions/revoke-others'
  });

  const authRoutes = Object.freeze({
    [routes.LOGIN]: 'login',
    [routes.REFRESH]: 'refresh',
    [routes.VALIDATE]: 'validate',
    [routes.LICENSE]: 'license',
    [routes.LOGOUT]: 'logout'
  });

  const adminRoutes = Object.freeze({
    [routes.ADMIN_LOGIN]: 'login',
    [routes.ADMIN_ACCOUNTS]: 'listAccounts',
    [routes.ADMIN_ACCOUNT_CREATE]: 'createAccount',
    [routes.ADMIN_LICENSE]: 'updateLicense',
    [routes.ADMIN_ACCOUNT_STATUS]: 'setAccountStatus',
    [routes.ADMIN_DEVICES]: 'listDevices',
    [routes.ADMIN_SESSIONS]: 'listSessions',
    [routes.ADMIN_DEVICE_REVOKE]: 'revokeDevice',
    [routes.ADMIN_SESSIONS_REVOKE]: 'revokeSessions',
    [routes.ADMIN_PASSWORD_RESET]: 'resetPassword',
    [routes.ADMIN_AUDIT]: 'listAudit'
  });

  const accountRoutes = Object.freeze({
    [routes.ACCOUNT_SUMMARY]: 'summary',
    [routes.ACCOUNT_DEVICES]: 'devices',
    [routes.ACCOUNT_SESSIONS]: 'sessions',
    [routes.ACCOUNT_DEVICE_REVOKE]: 'revokeDevice',
    [routes.ACCOUNT_SESSION_REVOKE]: 'revokeSession',
    [routes.ACCOUNT_SESSIONS_REVOKE]: 'revokeOtherSessions'
  });

  const postRoutes = Object.freeze([
    ...Object.keys(authRoutes),
    ...Object.keys(adminRoutes),
    ...Object.keys(accountRoutes)
  ]);

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const context = { ip: clientIp(request, config), bearer: bearerOf(request) };

    if (url.pathname === '/health' && request.method === 'GET') {
      const report = health.report();
      return json(response, report.ok ? 200 : 503, report);
    }

    if (request.method === 'GET' && serveAdmin(url.pathname, response)) return;

    if (!postRoutes.includes(url.pathname) || request.method !== 'POST') {
      return json(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } });
    }

    if (!originAllowed(request, config)) {
      return json(response, 403, { ok: false, error: { code: 'ORIGIN_BLOCKED', message: 'Origem não autorizada.' } });
    }

    const nonce = request.headers['x-request-id'];
    if (!nonces.check(nonce)) {
      return json(response, 400, { ok: false, error: { code: 'REQUEST_ID_INVALID', message: 'Identificador de requisição inválido.' } });
    }

    try {
      const body = await readBody(request);
      let result;
      if (Object.prototype.hasOwnProperty.call(authRoutes, url.pathname)) {
        result = auth[authRoutes[url.pathname]](body, context);
      } else if (Object.prototype.hasOwnProperty.call(accountRoutes, url.pathname)) {
        result = account[accountRoutes[url.pathname]](body, context);
      } else {
        result = admin[adminRoutes[url.pathname]](body, context);
      }
      return json(response, 200, { ok: true, data: result });
    } catch (error) {
      const outcome = errorPayload(error);
      if (outcome.status === 429) {
        response.setHeader('retry-after', String(error.retryAfter || 1));
      }
      return json(response, outcome.status, outcome.body);
    }
  });

  return { server, config, db, auth, admin, account, health, routes };
}

function listen(options = {}) {
  const app = createApp(options);
  const tls = app.config.tlsKey && app.config.tlsCert
    ? { key: fs.readFileSync(app.config.tlsKey), cert: fs.readFileSync(app.config.tlsCert) }
    : null;
  const service = tls
    ? require('node:https').createServer(tls, app.server.listeners('request')[0])
    : app.server;

  return new Promise(resolve => {
    service.listen(app.config.port, app.config.host, () => resolve({ ...app, service, tls: Boolean(tls) }));
  });
}

if (require.main === module) {
  listen().then(app => {
    console.log(`Last Training API em ${app.tls ? 'https' : 'http'}://${app.config.host}:${app.config.port}`);
    if (app.config.ephemeralSecret) {
      console.log('AUTH_JWT_SECRET não definido: chave efêmera (sessões não sobrevivem ao reinício).');
    }
    if (!app.tls) {
      console.log('TLS não configurado: use LT_TLS_KEY e LT_TLS_CERT em produção.');
    }
    console.log(`Painel administrativo em ${app.tls ? 'https' : 'http'}://${app.config.host}:${app.config.port}/admin`);
  }).catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { createApp, listen };
