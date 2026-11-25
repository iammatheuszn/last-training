'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveAuthBase, ENV_KEY } = require('../auth/endpoint');

test('endpoint do cliente usa variável de ambiente primeiro', () => {
  const file = path.join(os.tmpdir(), `lt-runtime-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ authApiBaseUrl: 'https://arquivo.local/' }));
  const base = resolveAuthBase({ [ENV_KEY]: 'https://ambiente.local:9443/' }, [file]);
  assert.equal(base, 'https://ambiente.local:9443');
  fs.rmSync(file, { force: true });
});

test('endpoint do cliente lê runtime.json quando não há variável', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-runtime-'));
  const file = path.join(dir, 'runtime.json');
  fs.writeFileSync(file, JSON.stringify({ authApiBaseUrl: 'https://127.0.0.1:8787/' }));
  assert.equal(resolveAuthBase({}, [file]), 'https://127.0.0.1:8787');
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
