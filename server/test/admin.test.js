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
const { seedAdmin, ensureDemoAdmin, DEMO_ADMIN } = require('../scripts/seed-admin');
const { verify } = require('../security/tokens');

const ADMIN_IDENTITY = 'admin@lasttraining.local';
const ADMIN_PASSWORD = 'senha-admin-bem-forte';
const USER_IDENTITY = 'user@example.com';
const USER_PASSWORD = 'senha-usuario-forte';

function setup(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-admin-test-'));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch {  }
  });

  const dbPath = path.join(dir, 'test.db');
  seed({
    dbPath,
    identity: USER_IDENTITY,
    password: USER_PASSWORD,
    display: 'Usuario',
    plan: 'pro',
    status: 'active'
  });
  seedAdmin({
    dbPath,
    identity: ADMIN_IDENTITY,
    password: ADMIN_PASSWORD,
    display: 'Root'
  });

  const app = createApp({
    dbPath,
    jwtSecret: 'test-secret-with-at-least-32-bytes',
    port: 0,
    adminLoginMaxFailures: 3,
    adminLoginWindowMs: 60000,
    adminLoginLockMs: 60000,
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

function request(server, route, body, headers = {}, method = 'POST') {
  return new Promise((resolve, reject) => {
    const payload = method === 'POST' ? Buffer.from(JSON.stringify(body || {})) : Buffer.alloc(0);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: server.address().port,
        path: route,
        method,
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
          let parsed;
          try { parsed = JSON.parse(raw); }
          catch { parsed = raw; }
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: parsed
          });
        });
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

async function adminSession(server) {
  const result = await request(server, '/v1/admin/login', {
    identity: ADMIN_IDENTITY,
    password: ADMIN_PASSWORD
  });
  assert.equal(result.status, 200);
  return { token: result.body.data.token, account: result.body.data.account };
}

function auth(token) {
  return { authorization: `Bearer ${token}` };
}

function desktopLogin(server, identity, password, deviceId = randomUUID()) {
  return request(server, '/v1/auth/login', {
    identity,
    password,
    device: { id: deviceId, name: 'admin-test' }
  });
}

test('token de usuário não acessa rotas administrativas', async t => {
  const { app } = setup(t);
  await listen(t, app);

  const login = await desktopLogin(app.server, USER_IDENTITY, USER_PASSWORD);
  assert.equal(login.status, 200);

  const denied = await request(app.server, '/v1/admin/accounts', {}, auth(login.body.data.token));
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'FORBIDDEN');

  const missing = await request(app.server, '/v1/admin/accounts', {});
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error.code, 'TOKEN_INVALID');
});

test('login administrativo emite token com tipo admin', async t => {
  const { app } = setup(t);
  await listen(t, app);

  const session = await adminSession(app.server);
  const claims = verify(session.token, app.config.jwtSecret, 'admin');
  assert.equal(claims.typ, 'admin');
  assert.equal(claims.role, 'admin');
  assert.equal(session.account.role, 'admin');

  const forged = await request(app.server, '/v1/admin/audit', {}, {
    authorization: `Bearer ${require('../security/tokens').issue(
      { sub: session.account.id, typ: 'access' },
      app.config.jwtSecret,
      900
    ).token}`
  });
  assert.equal(forged.status, 403);
  assert.equal(forged.body.error.code, 'FORBIDDEN');
});

test('criação de conta e licença suspensa bloqueiam login desktop', async t => {
  const { app, db } = setup(t);
  await listen(t, app);
  const admin = await adminSession(app.server);

  const created = await request(app.server, '/v1/admin/accounts/create', {
    email: 'nova@example.com',
    display: 'Nova Conta',
    password: 'senha-nova-forte',
    plan: 'pro',
    status: 'active'
  }, auth(admin.token));
  assert.equal(created.status, 200);
  assert.equal(created.body.data.license.status, 'active');

  const firstLogin = await desktopLogin(app.server, 'nova@example.com', 'senha-nova-forte');
  assert.equal(firstLogin.status, 200);

  const suspended = await request(app.server, '/v1/admin/license', {
    accountId: created.body.data.id,
    plan: 'pro',
    status: 'suspended',
    features: ['tracking']
  }, auth(admin.token));
  assert.equal(suspended.status, 200);

  const blocked = await desktopLogin(app.server, 'nova@example.com', 'senha-nova-forte', randomUUID());
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'LICENSE_SUSPENDED');
  assert.ok(db.prepare('SELECT 1 FROM audit WHERE event = ?').get('admin_license_updated'));
});

test('dispositivo revogado pelo admin bloqueia renovação de sessão', async t => {
  const { app } = setup(t);
  await listen(t, app);
  const admin = await adminSession(app.server);

  const created = await request(app.server, '/v1/admin/accounts/create', {
    email: 'device@example.com',
    display: 'Device Teste',
    password: 'senha-device-forte',
    plan: 'pro',
    status: 'active'
  }, auth(admin.token));
  assert.equal(created.status, 200);

  const login = await desktopLogin(app.server, 'device@example.com', 'senha-device-forte');
  assert.equal(login.status, 200);

  const devices = await request(app.server, '/v1/admin/devices', {
    accountId: created.body.data.id
  }, auth(admin.token));
  assert.equal(devices.status, 200);
  assert.equal(devices.body.data.length, 1);

  const revoked = await request(app.server, '/v1/admin/devices/revoke', {
    deviceId: devices.body.data[0].id
  }, auth(admin.token));
  assert.equal(revoked.status, 200);

  const refresh = await request(app.server, '/v1/auth/refresh', {
    refreshToken: login.body.data.refreshToken
  }, auth(login.body.data.token));
  assert.equal(refresh.status, 403);
  assert.equal(refresh.body.error.code, 'DEVICE_REVOKED');
});

test('reset de senha revoga sessões e exige nova credencial', async t => {
  const { app } = setup(t);
  await listen(t, app);
  const admin = await adminSession(app.server);

  const account = await dbAccount(app, USER_IDENTITY);
  const login = await desktopLogin(app.server, USER_IDENTITY, USER_PASSWORD);
  assert.equal(login.status, 200);

  const reset = await request(app.server, '/v1/admin/password-reset', {
    accountId: account.id,
    password: 'senha-trocada-forte'
  }, auth(admin.token));
  assert.equal(reset.status, 200);
  assert.equal(reset.body.data.revoked, 1);

  const refresh = await request(app.server, '/v1/auth/refresh', {
    refreshToken: login.body.data.refreshToken
  }, auth(login.body.data.token));
  assert.equal(refresh.status, 401);
  assert.equal(refresh.body.error.code, 'SESSION_REVOKED');

  const oldPassword = await desktopLogin(app.server, USER_IDENTITY, USER_PASSWORD, randomUUID());
  assert.equal(oldPassword.status, 401);

  const newPassword = await desktopLogin(app.server, USER_IDENTITY, 'senha-trocada-forte', randomUUID());
  assert.equal(newPassword.status, 200);
});

async function dbAccount(app, identity) {
  return app.db.prepare('SELECT id FROM accounts WHERE email = ?').get(identity);
}

test('falhas administrativas repetidas travam o login', async t => {
  const { app } = setup(t, { adminLoginMaxFailures: 2 });
  await listen(t, app);

  for (let i = 0; i < 2; i += 1) {
    const bad = await request(app.server, '/v1/admin/login', {
      identity: ADMIN_IDENTITY,
      password: 'errada'
    });
    assert.equal(bad.status, 401);
  }

  const locked = await request(app.server, '/v1/admin/login', {
    identity: ADMIN_IDENTITY,
    password: ADMIN_PASSWORD
  });
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error.code, 'RATE_LIMITED');
});

test('painel consulta dispositivos e sessões globalmente', async t => {
  const { app } = setup(t);
  await listen(t, app);
  const admin = await adminSession(app.server);
  await desktopLogin(app.server, USER_IDENTITY, USER_PASSWORD);

  const devices = await request(app.server, '/v1/admin/devices', {}, auth(admin.token));
  assert.equal(devices.status, 200);
  assert.ok(Array.isArray(devices.body.data));
  assert.ok(devices.body.data.some(device => device.accountEmail === USER_IDENTITY));

  const sessions = await request(app.server, '/v1/admin/sessions', {}, auth(admin.token));
  assert.equal(sessions.status, 200);
  assert.ok(Array.isArray(sessions.body.data));
  assert.ok(sessions.body.data.some(item => item.accountEmail === USER_IDENTITY));
});

test('painel mostra IP e HWID registrados no login desktop', async t => {
  const { app } = setup(t);
  await listen(t, app);
  const admin = await adminSession(app.server);
  const account = await dbAccount(app, USER_IDENTITY);
  const hwid = 'machine-guid-de-teste';

  const login = await request(app.server, '/v1/auth/login', {
    identity: USER_IDENTITY,
    password: USER_PASSWORD,
    device: { id: randomUUID(), name: 'hwid-test', hwid }
  });
  assert.equal(login.status, 200);

  const devices = await request(app.server, '/v1/admin/devices', {
    accountId: account.id
  }, auth(admin.token));
  assert.equal(devices.status, 200);
  assert.equal(devices.body.data.length, 1);
  assert.equal(devices.body.data[0].hwid, hwid);
  assert.ok(devices.body.data[0].ip);
});

test('painel estático é servido com CSP e sem segredos', async t => {
  const { app } = setup(t);
  await listen(t, app);

  const page = await request(app.server, '/admin', {}, {}, 'GET');
  assert.equal(page.status, 200);
  assert.match(String(page.headers['content-security-policy']), /connect-src 'self'/);
  assert.match(page.body, /Painel administrativo/);
  assert.match(page.body, /\/admin\/assets\//);

  const manifestPath = path.join(__dirname, '..', 'admin', 'dist', '.vite', 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entry = Object.values(manifest).find(item => item.isEntry) || Object.values(manifest)[0];
    const assetRoute = `/admin/${String(entry.file).replace(/^\/+/, '')}`;
    const script = await request(app.server, assetRoute, {}, {}, 'GET');
    assert.equal(script.status, 200);
    assert.doesNotMatch(script.body, /LT_ADMIN_PASSWORD/);
    assert.doesNotMatch(script.body, new RegExp(ADMIN_PASSWORD));
  }

  const logo = await request(app.server, '/admin/logo.png', {}, {}, 'GET');
  assert.equal(logo.status, 200);
  assert.match(String(logo.headers['content-type']), /image\/png/);

  const traversal = await request(app.server, '/admin/../config.js', {}, {}, 'GET');
  assert.equal(traversal.status, 404);
});

test('conta administrativa de demonstração é criada uma vez', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-demo-admin-'));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch {  }
  });
  const dbPath = path.join(dir, 'demo.db');

  const first = ensureDemoAdmin({ dbPath, environment: 'development' });
  const second = ensureDemoAdmin({ dbPath, environment: 'development' });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.id, second.id);

  const db = require('../db').open(dbPath);
  const row = db.prepare('SELECT role, password_hash FROM accounts WHERE email = ?').get(DEMO_ADMIN.email);
  const license = db.prepare('SELECT status, plan FROM licenses WHERE account_id = ?').get(first.id);
  assert.equal(row.role, 'admin');
  assert.notEqual(row.password_hash, DEMO_ADMIN.password);
  assert.equal(license.status, 'active');
  assert.equal(license.plan, 'pro');
  db.close();
});
