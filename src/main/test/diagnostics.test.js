'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveAuthBaseDetailed, ENV_KEY } = require('../auth/endpoint');
const { provider, CODES } = require('../auth/provider');

const originalEnv = process.env[ENV_KEY];

function restoreEnv() {
  if (originalEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = originalEnv;
}

test('endpoint detalhado identifica env, runtime e ausência', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-diagnostic-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const runtime = path.join(dir, 'runtime.json');
  fs.writeFileSync(runtime, JSON.stringify({ authApiBaseUrl: 'https://runtime.local:8787/' }));

  const fromEnv = resolveAuthBaseDetailed({ [ENV_KEY]: 'https://env.local:9443/' }, [runtime]);
  assert.equal(fromEnv.base, 'https://env.local:9443');
  assert.equal(fromEnv.source, 'env');

  const fromRuntime = resolveAuthBaseDetailed({}, [runtime]);
  assert.equal(fromRuntime.base, 'https://runtime.local:8787');
  assert.equal(fromRuntime.source, 'runtime');

  const absent = resolveAuthBaseDetailed({}, [path.join(dir, 'missing.json')]);
  assert.equal(absent.base, '');
  assert.equal(absent.source, 'none');
});

test('diagnóstico recusa endpoint HTTP sem consultar o backend', async () => {
  process.env[ENV_KEY] = 'http://inseguro.local:8787';
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => {
    called = true;
    throw new Error('não deveria consultar');
  };

  try {
    const report = await provider.diagnostics();
    assert.equal(report.status, 'insecure');
    assert.equal(report.code, CODES.INSECURE_ENDPOINT);
    assert.equal(report.endpoint.https, false);
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
    restoreEnv();
  }
});

test('diagnóstico reporta /health, latência e origem do endpoint', async () => {
  process.env[ENV_KEY] = 'https://seguro.local:9443/';
  const originalFetch = global.fetch;
  let requested = '';
  global.fetch = async (url, options) => {
    requested = String(url);
    assert.equal(options.method, 'GET');
    assert.match(options.headers['x-request-id'], /^[0-9a-f-]{36}$/i);
    return {
      status: 200,
      ok: true,
      json: async () => ({ ok: true, version: 1 })
    };
  };

  try {
    const report = await provider.diagnostics();
    assert.equal(report.status, 'ready');
    assert.equal(report.endpoint.source, 'env');
    assert.equal(report.endpoint.base, 'https://seguro.local:9443');
    assert.equal(report.httpStatus, 200);
    assert.ok(report.latencyMs >= 0);
    assert.equal(report.checks[0].status, 'ok');
    assert.equal(report.checks[1].status, 'ok');
    assert.equal(requested, 'https://seguro.local:9443/health');
  } finally {
    global.fetch = originalFetch;
    restoreEnv();
  }
});
