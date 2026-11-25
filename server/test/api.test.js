'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { createApp } = require('../index');
const { seed } = require('../scripts/seed');
const { verify, issue } = require('../security/tokens');
const { RateLimiter } = require('../security/ratelimit');

function setup(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-test-'));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch {  }
  });
  const dbPath = path.join(dir, 'test.db');
  seed({
    dbPath,
    identity: 'olivia@example.com',
    password: 'senha-forte-local',
    display: 'Olivia',
    plan: 'pro',
    status: 'active'
  });
  const app = createApp({
    dbPath,
    jwtSecret: 'test-secret-with-at-least-32-bytes',
    port: 0,
    loginMaxFailures: 3,
    ...overrides
  });
  return { app, db: app.db, config: app.config };
}

function request(server, route, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const payload = Buffer.from(JSON.stringify(body));
    const req = require('node:http').request(
      {
        host: '127.0.0.1',
        port: address.port,
        path: route,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': payload.length,
          'x-request-id': randomUUID(),
          connection: 'close',
          ...extraHeaders
        }
      },
      response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: response.statusCode, body: JSON.parse(text) });
        });
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function credential(deviceId) {
  return {
    identity: 'olivia@example.com',
    password: 'senha-forte-local',
    device: { id: deviceId || randomUUID(), name: 'bench-test' }
  };
}

test('login emite token assinado, refresh e licença ativa', async t => {
  const { app } = setup(t);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    app.server.closeAllConnections();
    app.server.close(() => {
      app.db.close();
      resolve();
    });
  }));

  const result = await request(app.server, '/v1/auth/login', credential());
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.data.license.status, 'active');
  assert.equal(result.body.data.account.display, 'Olivia');
  assert.equal(verify(result.body.data.token, app.config.jwtSecret, 'access').typ, 'access');
  assert.match(result.body.data.refreshToken, /^[A-Za-z0-9_-]{40,}$/);
});

test('senha errada não cria sessão e falhas são limitadas', async t => {
  const { app } = setup(t);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    app.server.closeAllConnections();
    app.server.close(() => {
      app.db.close();
      resolve();
    });
  }));

  const bad = credential();
  bad.password = 'errada';
  for (let i = 0; i < 3; i += 1) {
    const result = await request(app.server, '/v1/auth/login', bad);
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'INVALID_CREDENTIALS');
  }
  const locked = await request(app.server, '/v1/auth/login', credential());
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error.code, 'RATE_LIMITED');
});

test('refresh usa token de uso único e detecta replay', async t => {
  const { app } = setup(t);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    app.server.closeAllConnections();
    app.server.close(() => {
      app.db.close();
      resolve();
    });
  }));

  const login = await request(app.server, '/v1/auth/login', credential());
  const headers = { authorization: `Bearer ${login.body.data.token}` };
  const first = await request(app.server, '/v1/auth/refresh', {
    refreshToken: login.body.data.refreshToken
  }, headers);
  assert.equal(first.status, 200);

  const replay = await request(app.server, '/v1/auth/refresh', {
    refreshToken: login.body.data.refreshToken
  }, headers);
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error.code, 'SESSION_REVOKED');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS total FROM audit WHERE event = ?').get('replay_detected').total, 1);
});

test('validação rejeita token forjado e licença suspensa bloqueia login', async t => {
  const { app, db } = setup(t);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    app.server.closeAllConnections();
    app.server.close(() => {
      app.db.close();
      resolve();
    });
  }));

  const forged = await request(app.server, '/v1/auth/validate', {
    token: issue({ sub: 'x', typ: 'access' }, ' outro-secret ', 900).token
  });
  assert.equal(forged.status, 401);
  assert.equal(forged.body.error.code, 'TOKEN_INVALID');

  const account = db.prepare('SELECT id FROM accounts WHERE email = ?').get('olivia@example.com');
  db.prepare('UPDATE licenses SET status = ? WHERE account_id = ?').run('suspended', account.id);
  const blocked = await request(app.server, '/v1/auth/login', credential());
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'LICENSE_SUSPENDED');
});

test('limite de dispositivos é aplicado no servidor', async t => {
  const { app, config } = setup(t, { maxDevices: 1 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    app.server.closeAllConnections();
    app.server.close(() => {
      app.db.close();
      resolve();
    });
  }));

  const first = await request(app.server, '/v1/auth/login', credential(randomUUID()));
  assert.equal(first.status, 200);
  const second = await request(app.server, '/v1/auth/login', credential(randomUUID()));
  assert.equal(second.status, 403);
  assert.equal(second.body.error.code, 'DEVICE_LIMIT');
});

test('rate limiter não registra requisição negada', () => {
  const limiter = new RateLimiter();
  const first = limiter.hit('k', 1, 1000, 100);
  assert.equal(first.allowed, true);
  const second = limiter.hit('k', 1, 1000, 200);
  assert.equal(second.allowed, false);
  assert.equal(limiter.hit('k', 1, 1000, 300).allowed, false);
  assert.equal(limiter.hit('k', 1, 1000, 1100).allowed, true);
});
