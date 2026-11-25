'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { validateEnvironment, parseEnvFile } = require('../env');
const { createConfig } = require('../config');
const { createApp } = require('../index');
const { seed } = require('../scripts/seed');

function tempDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-production-test-'));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch {  }
  });
  return path.join(dir, 'test.db');
}

function get(server, route, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path: route,
      method: 'GET',
      headers: { connection: 'close', ...headers }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

function post(server, route, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path: route,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': payload.length,
        'x-request-id': randomUUID(),
        connection: 'close',
        ...headers
      }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
      }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function listen(t, app) {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    app.server.closeAllConnections();
    app.server.close(() => {
      app.db.close();
      resolve();
    });
  }));
}

const PROD = {
  LT_ENV: 'production',
  AUTH_JWT_SECRET: 'a'.repeat(48),
  LT_PUBLIC_ORIGIN: 'https://app.example.com',
  LT_DB_PATH: 'server/data/last-training.db',
  LT_TLS_TERMINATED: 'true',
  LT_TRUST_PROXY: 'true',
  LT_TRUSTED_PROXIES: '127.0.0.1,::1',
  LT_AUTH_API_BASE_URL: 'https://app.example.com',
  LT_UPDATE_URL: 'https://updates.example.com'
};

test('validação de produção recusa segredo efêmero, HTTP e origem ausente', () => {
  assert.deepEqual(validateEnvironment(PROD), []);
  assert.ok(validateEnvironment({ ...PROD, AUTH_JWT_SECRET: '' }).some(item => item.includes('AUTH_JWT_SECRET')));
  assert.ok(validateEnvironment({ ...PROD, LT_PUBLIC_ORIGIN: 'http://app.example.com' }).some(item => item.includes('HTTPS')));
  assert.ok(validateEnvironment({ ...PROD, LT_DB_PATH: '' }).some(item => item.includes('LT_DB_PATH')));
  assert.deepEqual(validateEnvironment({ ...PROD, LT_TRUST_PROXY: 'false', LT_TRUSTED_PROXIES: '' }), []);
});

test('createConfig aplica modo produção e proxy confiável por override', () => {
  const config = createConfig({
    environment: 'production',
    jwtSecret: 'b'.repeat(48),
    publicOrigin: 'https://app.example.com',
    dbPath: 'server/data/last-training.db',
    tlsTerminated: true,
    trustProxy: true,
    trustedProxies: ['127.0.0.1'],
    baseUrl: 'https://app.example.com',
    authApiBaseUrl: 'https://app.example.com',
    updateUrl: 'https://updates.example.com'
  });
  assert.equal(config.production, true);
  assert.equal(config.trustProxy, true);
  assert.deepEqual(config.trustedProxies, ['127.0.0.1']);
  assert.equal(config.ephemeralSecret, false);
});

test('parser de .env ignora comentários e desembrulha aspas', () => {
  const parsed = parseEnvFile('# comentário\nLT_ENV=production\nLT_PUBLIC_ORIGIN="https://a.example"\nCHAVE=\'valor com espaço\'\n');
  assert.equal(parsed.LT_ENV, 'production');
  assert.equal(parsed.LT_PUBLIC_ORIGIN, 'https://a.example');
  assert.equal(parsed.CHAVE, 'valor com espaço');
});

test('health reporta banco real, licenças, auditoria e segredo', async t => {
  const dbPath = tempDb(t);
  seed({ dbPath, identity: 'health@example.com', password: 'senha-forte-health', display: 'Health', plan: 'pro', status: 'active' });
  const app = createApp({ dbPath, jwtSecret: 'c'.repeat(48) });
  await listen(t, app);

  const response = await get(app.server, '/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.checks.database.ok, true);
  assert.equal(response.body.checks.auth.ephemeralSecret, false);
  assert.equal(response.body.counts.accounts, 1);
  assert.equal(response.body.checks.licenses.active, 1);
});

test('proxy confiável registra IP do cliente do X-Forwarded-For', async t => {
  const dbPath = tempDb(t);
  const identity = 'proxy@example.com';
  seed({ dbPath, identity, password: 'senha-forte-proxy', display: 'Proxy', plan: 'pro', status: 'active' });
  const app = createApp({
    dbPath,
    jwtSecret: 'd'.repeat(48),
    trustProxy: true,
    trustedProxies: ['127.0.0.1']
  });
  await listen(t, app);

  const deviceId = randomUUID();
  const response = await post(app.server, '/v1/auth/login', {
    identity,
    password: 'senha-forte-proxy',
    device: { id: deviceId, name: 'remoto', hwid: 'hwid-proxy' }
  }, { 'x-forwarded-for': '203.0.113.44, 127.0.0.1' });

  assert.equal(response.status, 200);
  const device = app.db.prepare('SELECT ip, hwid FROM devices WHERE id = ?').get(deviceId);
  assert.equal(device.ip, '203.0.113.44');
  assert.equal(device.hwid, 'hwid-proxy');
});

test('X-Forwarded-For é ignorado quando proxy não é confiável', async t => {
  const dbPath = tempDb(t);
  const identity = 'direto@example.com';
  seed({ dbPath, identity, password: 'senha-forte-direto', display: 'Direto', plan: 'pro', status: 'active' });
  const app = createApp({ dbPath, jwtSecret: 'e'.repeat(48) });
  await listen(t, app);

  const deviceId = randomUUID();
  const response = await post(app.server, '/v1/auth/login', {
    identity,
    password: 'senha-forte-direto',
    device: { id: deviceId, name: 'local', hwid: 'hwid-direto' }
  }, { 'x-forwarded-for': '203.0.113.99' });

  assert.equal(response.status, 200);
  assert.equal(app.db.prepare('SELECT ip FROM devices WHERE id = ?').get(deviceId).ip, '127.0.0.1');
});
