'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { createApp } = require('../index');
const { seed } = require('../scripts/seed');

const IDENTITY = 'conta@example.com';
const PASSWORD = 'senha-conta-forte';
const DEVICE_A = randomUUID();
const DEVICE_B = randomUUID();
const DEVICE_C = randomUUID();

function setup(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-account-test-'));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch {  }
  });
  const dbPath = path.join(dir, 'test.db');
  seed({ dbPath, identity: IDENTITY, password: PASSWORD, display: 'Conta Teste', plan: 'pro', status: 'active' });
  const app = createApp({
    dbPath,
    jwtSecret: 'test-secret-with-at-least-32-bytes',
    port: 0,
    ...overrides
  });
  return { app, db: app.db };
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

function request(server, route, body = {}, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
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
      },
      response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({ status: response.statusCode, body: JSON.parse(raw), headers: response.headers });
        });
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function auth(token) {
  return { authorization: `Bearer ${token}` };
}

async function login(server, deviceId, name = 'bench') {
  const result = await request(server, '/v1/auth/login', {
    identity: IDENTITY,
    password: PASSWORD,
    device: { id: deviceId, name, hwid: `hwid-${deviceId}` }
  });
  assert.equal(result.status, 200);
  return result.body.data;
}

test('conta lê resumo, dispositivos e sessões autorizados pelo servidor', async t => {
  const { app } = setup(t);
  await listen(t, app);

  const first = await login(app.server, DEVICE_A, 'principal');
  await login(app.server, DEVICE_B, 'segundo');

  const summary = await request(app.server, '/v1/account/summary', {}, auth(first.token));
  assert.equal(summary.status, 200);
  assert.equal(summary.body.data.account.email, IDENTITY);
  assert.equal(summary.body.data.license.status, 'active');
  assert.equal(summary.body.data.counts.devices, 2);
  assert.equal(summary.body.data.counts.sessions, 2);
  assert.equal(summary.body.data.currentDevice.id, DEVICE_A);
  assert.equal(summary.body.data.currentDevice.hwid, `hwid-${DEVICE_A}`);
  assert.ok(summary.body.data.currentSessionId);

  const devices = await request(app.server, '/v1/account/devices', {}, auth(first.token));
  assert.equal(devices.body.data.length, 2);
  assert.equal(devices.body.data.find(item => item.id === DEVICE_A).current, true);
  assert.equal(devices.body.data.find(item => item.id === DEVICE_B).ip, '127.0.0.1');

  const sessions = await request(app.server, '/v1/account/sessions', {}, auth(first.token));
  assert.equal(sessions.body.data.length, 2);
  assert.equal(sessions.body.data.find(item => item.current).deviceId, DEVICE_A);
});

test('conta revoga dispositivo remoto sem revogar o atual', async t => {
  const { app, db } = setup(t);
  await listen(t, app);

  const first = await login(app.server, DEVICE_A);
  await login(app.server, DEVICE_B);

  const denied = await request(app.server, '/v1/account/devices/revoke', {
    deviceId: DEVICE_A
  }, auth(first.token));
  assert.equal(denied.status, 400);
  assert.equal(denied.body.error.code, 'CANNOT_REVOKE_CURRENT');

  const revoked = await request(app.server, '/v1/account/devices/revoke', {
    deviceId: DEVICE_B
  }, auth(first.token));
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.data.revoked, true);
  assert.equal(db.prepare('SELECT revoked FROM devices WHERE id = ?').get(DEVICE_B).revoked, 1);
  assert.equal(db.prepare('SELECT revoked FROM sessions WHERE device_id = ?').get(DEVICE_B).revoked, 1);

  const other = await request(app.server, '/v1/account/devices', {}, auth(first.token));
  assert.equal(other.body.data.find(item => item.id === DEVICE_B).revoked, true);

  const foreign = await request(app.server, '/v1/account/devices/revoke', {
    deviceId: randomUUID()
  }, auth(first.token));
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error.code, 'DEVICE_NOT_FOUND');
});

test('conta revoga outras sessões e sessão revogada falha na validação', async t => {
  const { app } = setup(t);
  await listen(t, app);

  const first = await login(app.server, DEVICE_A);
  const second = await login(app.server, DEVICE_B);
  await login(app.server, DEVICE_C);

  const sessions = await request(app.server, '/v1/account/sessions', {}, auth(first.token));
  const current = sessions.body.data.find(item => item.current);
  const remote = sessions.body.data.find(item => item.deviceId === DEVICE_B);

  const denied = await request(app.server, '/v1/account/sessions/revoke', {
    sessionId: current.id
  }, auth(first.token));
  assert.equal(denied.status, 400);
  assert.equal(denied.body.error.code, 'CANNOT_REVOKE_CURRENT');

  const revoked = await request(app.server, '/v1/account/sessions/revoke', {
    sessionId: remote.id
  }, auth(first.token));
  assert.equal(revoked.status, 200);

  const invalid = await request(app.server, '/v1/auth/validate', {}, auth(second.token));
  assert.equal(invalid.status, 401);
  assert.equal(invalid.body.error.code, 'SESSION_REVOKED');

  const others = await request(app.server, '/v1/account/sessions/revoke-others', {}, auth(first.token));
  assert.equal(others.status, 200);
  assert.equal(others.body.data.revoked, 1);

  const remaining = await request(app.server, '/v1/account/sessions', {}, auth(first.token));
  assert.equal(remaining.body.data.filter(item => !item.revoked).length, 1);
});

test('rotas de conta exigem token de acesso do próprio usuário', async t => {
  const { app } = setup(t);
  await listen(t, app);

  const missing = await request(app.server, '/v1/account/summary');
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error.code, 'TOKEN_INVALID');

  const first = await login(app.server, DEVICE_A);
  const forged = await request(app.server, '/v1/account/summary', {}, auth('token.forjado'));
  assert.equal(forged.status, 401);

  const valid = await request(app.server, '/v1/account/summary', {}, auth(first.token));
  assert.equal(valid.status, 200);
});
