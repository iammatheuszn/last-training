'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { createApp } = require('../server/index');
const { seed } = require('../server/scripts/seed');
const { issue } = require('../server/security/tokens');

const bruteIdentity = 'brute@lasttraining.local';
const abuseIdentity = 'abuse@lasttraining.local';
const password = 'AbuseLoad2026!';
const secret = 'abuse-load-secret-with-32-bytes';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  if (!server || !server.listening) return Promise.resolve();
  return new Promise(resolve => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

function request(port, route, body = {}, options = {}) {
  const payload = body === null ? null : Buffer.from(JSON.stringify(body));
  const nonce = options.nonce === undefined ? crypto.randomUUID() : options.nonce;
  const headers = { ...(options.headers || {}) };
  if (nonce) headers['x-request-id'] = String(nonce);
  if (payload) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(payload.length);
  }

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: route,
      method: options.method || (payload ? 'POST' : 'GET'),
      headers,
      agent: false
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {  }
        resolve({
          status: response.statusCode,
          headers: response.headers,
          text,
          json,
          latencyMs: Date.now() - started
        });
      });
    });
    req.once('error', reject);
    req.end(payload || undefined);
  });
}

function credential(identity, deviceId, secretPassword = password) {
  return {
    identity,
    password: secretPassword,
    device: { id: deviceId || crypto.randomUUID(), name: 'abuse-bench', hwid: `HWID-${crypto.randomUUID()}` }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runChecks() {
  const checks = [];
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-abuse-smoke-'));
  const dbPath = path.join(temp, 'server', 'data', 'last-training.db');
  const port = 0;
  let app = null;
  let failed = false;

  async function step(name, action) {
    try {
      const detail = await action();
      checks.push({ name, status: 'ok', detail: detail || '' });
      return detail;
    } catch (error) {
      checks.push({ name, status: 'fail', detail: error?.message || String(error) });
      failed = true;
      throw error;
    }
  }

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });

    await step('banco isolado', () => {
      const originalLog = console.log;
      console.log = () => {};
      try {
        seed({ dbPath, identity: bruteIdentity, password, display: 'Brute Olivia', plan: 'pro', status: 'active' });
        seed({ dbPath, identity: abuseIdentity, password, display: 'Abuse Olivia', plan: 'pro', status: 'active' });
      } finally {
        console.log = originalLog;
      }
      return path.relative(temp, dbPath);
    });

    const activePort = await step('API de teste', async () => {
      app = createApp({
        dbPath,
        jwtSecret: secret,
        port,
        loginMaxFailures: 4,
        loginWindowMs: 60000,
        globalMaxPerMinute: 2000,
        maxDevices: 2,
        requestIdTtlMs: 30000,
        trustProxy: false,
        trustedProxies: []
      });
      return listen(app.server);
    });

    await step('força bruta travada', async () => {
      const bad = credential(bruteIdentity, crypto.randomUUID(), 'errada');
      for (let index = 0; index < 4; index += 1) {
        const response = await request(activePort, '/v1/auth/login', bad);
        assert(response.status === 401, `tentativa ${index + 1}: HTTP ${response.status}`);
        assert(response.json?.error?.code === 'INVALID_CREDENTIALS', `tentativa ${index + 1}: ${response.text}`);
      }
      const locked = await request(activePort, '/v1/auth/login', bad);
      assert(locked.status === 429, `lock: HTTP ${locked.status}`);
      assert(locked.json?.error?.code === 'RATE_LIMITED', `lock: ${locked.text}`);
      assert(Number(locked.headers['retry-after']) >= 1, 'retry-after ausente');

      const correct = await request(activePort, '/v1/auth/login', credential(bruteIdentity, crypto.randomUUID()));
      assert(correct.status === 429, `senha correta sob lock: HTTP ${correct.status}`);

      const account = app.db.prepare('SELECT id FROM accounts WHERE email = ?').get(bruteIdentity);
      const sessions = app.db.prepare('SELECT COUNT(*) AS total FROM sessions WHERE account_id = ?').get(account.id).total;
      assert(sessions === 0, `sessões criadas por força bruta: ${sessions}`);
      return '4 falhas 401, quinta 429, zero sessões';
    });

    await step('rate limit global', async () => {
      const globalApp = createApp({
        dbPath,
        jwtSecret: secret,
        port: 0,
        loginMaxFailures: 100,
        loginWindowMs: 60000,
        globalMaxPerMinute: 5,
        maxDevices: 2,
        trustProxy: false,
        trustedProxies: []
      });
      const globalPort = await listen(globalApp.server);
      try {
        for (let index = 0; index < 5; index += 1) {
          const response = await request(globalPort, '/v1/auth/login', credential(bruteIdentity, crypto.randomUUID(), 'errada'));
          assert(response.status === 401, `global ${index + 1}: HTTP ${response.status}`);
        }
        const limited = await request(globalPort, '/v1/auth/login', credential(bruteIdentity, crypto.randomUUID(), 'errada'));
        assert(limited.status === 429, `global: HTTP ${limited.status}`);
        assert(limited.json?.error?.code === 'RATE_LIMITED', `global: ${limited.text}`);
        assert(Number(limited.headers['retry-after']) >= 1, 'retry-after global ausente');
        return '5 requisições 401, sexta 429';
      } finally {
        await close(globalApp.server);
        globalApp.db.close();
      }
    });

    await step('nonce de requisição', async () => {
      const missing = await request(activePort, '/v1/account/summary', {}, { nonce: null });
      assert(missing.status === 400, `sem nonce: HTTP ${missing.status}`);
      assert(missing.json?.error?.code === 'REQUEST_ID_INVALID', `sem nonce: ${missing.text}`);

      const nonce = crypto.randomUUID();
      const first = await request(activePort, '/v1/account/summary', {}, { nonce });
      assert(first.status === 401, `primeiro uso: HTTP ${first.status}`);
      const replay = await request(activePort, '/v1/account/summary', {}, { nonce });
      assert(replay.status === 400, `replay: HTTP ${replay.status}`);
      assert(replay.json?.error?.code === 'REQUEST_ID_INVALID', `replay: ${replay.text}`);
      return 'ausente e repetido rejeitados';
    });

    await step('token forjado', async () => {
      const forged = issue({ sub: 'x', typ: 'access', device: crypto.randomUUID() }, 'another-secret-with-32-bytes-long', 900);
      const response = await request(activePort, '/v1/auth/validate', { token: forged.token });
      assert(response.status === 401, `HTTP ${response.status}`);
      assert(response.json?.error?.code === 'TOKEN_INVALID', response.text);
      return '401 TOKEN_INVALID';
    });

    const rotation = await step('refresh e replay', async () => {
      const deviceId = crypto.randomUUID();
      const login = await request(activePort, '/v1/auth/login', credential(abuseIdentity, deviceId));
      assert(login.status === 200, `login: HTTP ${login.status}`);
      const token = login.json.data.token;
      const refreshToken = login.json.data.refreshToken;
      const headers = { authorization: `Bearer ${token}` };

      const first = await request(activePort, '/v1/auth/refresh', { refreshToken }, { headers });
      assert(first.status === 200, `refresh: HTTP ${first.status}`);
      const rotated = await request(activePort, '/v1/auth/validate', {}, {
        headers: { authorization: `Bearer ${first.json.data.token}` }
      });
      assert(rotated.status === 200, `token rotacionado: HTTP ${rotated.status}`);

      const replay = await request(activePort, '/v1/auth/refresh', { refreshToken }, { headers });
      assert(replay.status === 401, `replay: HTTP ${replay.status}`);
      assert(replay.json?.error?.code === 'SESSION_REVOKED', `replay: ${replay.text}`);
      const killed = await request(activePort, '/v1/auth/validate', {}, {
        headers: { authorization: `Bearer ${first.json.data.token}` }
      });
      assert(killed.status === 401, `sessões após replay: HTTP ${killed.status}`);
      assert(killed.json?.error?.code === 'SESSION_REVOKED', `sessões após replay: ${killed.text}`);

      const audit = app.db.prepare("SELECT COUNT(*) AS total FROM audit WHERE event = 'replay_detected'").get().total;
      assert(audit === 1, `eventos replay_detected: ${audit}`);
      return { deviceId };
    });

    await step('limite de dispositivos', async () => {
      const first = rotation.deviceId;
      const second = crypto.randomUUID();
      const third = crypto.randomUUID();
      const secondLogin = await request(activePort, '/v1/auth/login', credential(abuseIdentity, second));
      assert(secondLogin.status === 200, `segundo device: HTTP ${secondLogin.status}`);
      const overflow = await request(activePort, '/v1/auth/login', credential(abuseIdentity, third));
      assert(overflow.status === 403, `terceiro device: HTTP ${overflow.status}`);
      assert(overflow.json?.error?.code === 'DEVICE_LIMIT', `terceiro device: ${overflow.text}`);

      const current = await request(activePort, '/v1/auth/login', credential(abuseIdentity, first));
      assert(current.status === 200, `device atual: HTTP ${current.status}`);
      const currentToken = current.json.data.token;
      const currentHeaders = { authorization: `Bearer ${currentToken}` };

      const revokeSelf = await request(activePort, '/v1/account/devices/revoke', { deviceId: first }, { headers: currentHeaders });
      assert(revokeSelf.status === 400, `revogar atual: HTTP ${revokeSelf.status}`);
      assert(revokeSelf.json?.error?.code === 'CANNOT_REVOKE_CURRENT', `revogar atual: ${revokeSelf.text}`);

      const revoke = await request(activePort, '/v1/account/devices/revoke', { deviceId: second }, { headers: currentHeaders });
      assert(revoke.status === 200, `revogar segundo: HTTP ${revoke.status}`);
      assert(revoke.json?.data?.revoked === true, `revogar segundo: ${revoke.text}`);

      const revokedRefresh = await request(activePort, '/v1/auth/refresh', { refreshToken: secondLogin.json.data.refreshToken });
      assert(revokedRefresh.status === 403, `refresh revogado: HTTP ${revokedRefresh.status}`);
      assert(revokedRefresh.json?.error?.code === 'DEVICE_REVOKED', `refresh revogado: ${revokedRefresh.text}`);

      const revokedValidate = await request(activePort, '/v1/auth/validate', {}, {
        headers: { authorization: `Bearer ${secondLogin.json.data.token}` }
      });
      assert(revokedValidate.status === 403, `validate revogado: HTTP ${revokedValidate.status}`);
      assert(revokedValidate.json?.error?.code === 'DEVICE_REVOKED', `validate revogado: ${revokedValidate.text}`);

      const others = await request(activePort, '/v1/account/sessions/revoke-others', {}, { headers: currentHeaders });
      assert(others.status === 200, `revoke-others: HTTP ${others.status}`);
      const stillValid = await request(activePort, '/v1/auth/validate', {}, { headers: currentHeaders });
      assert(stillValid.status === 200, `sessão atual após revoke-others: HTTP ${stillValid.status}`);

      const limitEvents = app.db.prepare("SELECT COUNT(*) AS total FROM audit WHERE event = 'device_limit'").get().total;
      assert(limitEvents === 1, `eventos device_limit: ${limitEvents}`);
      return '2 devices ativos, terceiro 403, revogação 403 em refresh e validate';
    });

    await step('/health sob carga', async () => {
      const total = 120;
      const started = Date.now();
      const responses = await Promise.all(
        Array.from({ length: total }, () => request(activePort, '/health', null))
      );
      const elapsed = Date.now() - started;
      const latencies = responses.map(item => item.latencyMs).sort((a, b) => a - b);
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      const bad = responses.filter(item => item.status !== 200 || item.json?.ok !== true);
      assert(bad.length === 0, `${bad.length}/${total} respostas falharam`);
      assert(p95 <= 3000, `p95 ${p95}ms acima de 3000ms`);
      return `${total} requisições, ${elapsed}ms total, p95 ${p95}ms`;
    });

    await step('auditoria consolidada', () => {
      const events = [
        'login_failed', 'replay_detected', 'device_limit',
        'account_device_revoked', 'account_other_sessions_revoked'
      ];
      const counts = events.map(event => ({
        event,
        total: app.db.prepare('SELECT COUNT(*) AS total FROM audit WHERE event = ?').get(event).total
      }));
      for (const item of counts) assert(item.total > 0, `${item.event} ausente`);
      return counts.map(item => `${item.event}:${item.total}`).join(' ');
    });

    return { ok: !failed, status: failed ? 'fail' : 'ok', checks };
  } catch {
    return { ok: false, status: 'fail', checks };
  } finally {
    if (app) {
      await close(app.server);
      try { app.db.close(); } catch {  }
    }
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
}

if (require.main === module) {
  runChecks()
    .then(report => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
    })
    .catch(error => {
      console.error(error?.message || String(error));
      process.exit(1);
    });
}

module.exports = { runChecks };
