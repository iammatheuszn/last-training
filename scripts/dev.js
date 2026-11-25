'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');

const root = path.join(__dirname, '..');
const node = process.execPath;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const port = String(process.env.LT_SERVER_PORT || '8787');
const base = `https://127.0.0.1:${port}`;
const certKey = path.join(root, 'certs', 'dev.key');
const cert = path.join(root, 'certs', 'dev.crt');
const secretFile = path.join(root, 'config', 'dev-secret.json');

function devSecret() {
  if (process.env.AUTH_JWT_SECRET) return process.env.AUTH_JWT_SECRET;
  try {
    const saved = JSON.parse(fs.readFileSync(secretFile, 'utf8'));
    if (typeof saved.secret === 'string' && saved.secret.length >= 32) return saved.secret;
  } catch {
  }
  const secret = randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  fs.writeFileSync(secretFile, `${JSON.stringify({ secret }, null, 2)}\n`, { mode: 0o600 });
  return secret;
}

function health() {
  return new Promise(resolve => {
    const client = base.startsWith('https:') ? https : http;
    const request = client.get(`${base}/health`, { rejectUnauthorized: false }, response => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.setTimeout(1000, () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await health()) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

async function main() {
  execFileSync(node, [path.join(__dirname, 'make-dev-cert.js')], { cwd: root, stdio: 'inherit' });

  const env = {
    ...process.env,
    AUTH_JWT_SECRET: devSecret(),
    LT_SERVER_PORT: port,
    LT_SCHEME: 'https',
    LT_BASE_URL: base,
    LT_ADMIN_URL: `${base}/admin`,
    LT_AUTH_API_BASE_URL: base,
    LT_TLS_KEY: certKey,
    LT_TLS_CERT: cert,
    NODE_EXTRA_CA_CERTS: cert
  };

  execFileSync(node, [path.join(__dirname, 'write-runtime-config.js')], { cwd: root, env, stdio: 'inherit' });

  let server = null;
  if (!(await health())) {
    server = spawn(node, [path.join(root, 'server', 'index.js')], { cwd: root, env, stdio: 'inherit' });
    if (!(await waitForServer())) throw new Error(`o backend não respondeu em ${base}`);
    console.log(`backend HTTPS pronto em ${base}`);
  } else {
    console.log(`backend HTTPS já ativo em ${base}`);
  }

  const frontend = spawn(npm, ['run', 'dev:app'], { cwd: root, env, stdio: 'inherit', shell: true });

  const shutdown = () => {
    frontend.kill('SIGTERM');
    if (server && !server.killed) server.kill('SIGTERM');
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  frontend.on('exit', code => {
    if (server && !server.killed) server.kill('SIGTERM');
    process.exit(code ?? 0);
  });
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
