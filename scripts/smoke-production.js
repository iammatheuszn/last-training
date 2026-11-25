'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const net = require('node:net');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const selfsigned = require('selfsigned');
const { ENV_KEYS } = require('../server/env');
const { verify } = require('../server/security/tokens');
const { verifySignedManifest, fetchSignedManifest } = require('../src/main/update/signature');

const root = path.join(__dirname, '..');
const execFileAsync = promisify(execFile);
const checks = [];
let failed = false;

function cleanEnvironment() {
  const env = { ...process.env };
  for (const key of ENV_KEYS) delete env[key];
  delete env.NODE_EXTRA_CA_CERTS;
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  return env;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function envLine(key, value) {
  const text = String(value);
  return `${key}=${/[\s"']/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text}`;
}

function writeEnv(file, values) {
  fs.writeFileSync(file, `${Object.entries(values).map(([key, value]) => envLine(key, value)).join('\n')}\n`, { mode: 0o600 });
}

function httpsRequest(url, options = {}) {
  const target = new URL(url);
  const headers = { ...(options.headers || {}) };
  const body = options.body ? Buffer.from(options.body) : null;
  const ca = typeof options.ca === 'string' && fs.existsSync(options.ca)
    ? fs.readFileSync(options.ca)
    : options.ca;
  if (body) {
    headers['content-length'] = String(body.length);
    if (!headers['content-type']) headers['content-type'] = 'application/json';
  }

  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: options.method || 'GET',
      headers,
      ca
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const bytes = Buffer.concat(chunks);
        resolve({
          status: response.statusCode,
          headers: response.headers,
          bytes,
          text: bytes.toString('utf8'),
          json: () => JSON.parse(bytes.toString('utf8'))
        });
      });
    });
    request.once('error', reject);
    request.end(body || undefined);
  });
}

function makeFetch(ca) {
  return async (url, options = {}) => {
    const response = await httpsRequest(url, { method: options.method || 'GET', headers: options.headers || {}, ca });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.json()
    };
  };
}

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

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function close(server) {
  if (!server || !server.listening) return;
  await new Promise(resolve => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

async function main() {
  const baseEnv = cleanEnvironment();
  Object.assign(process.env, baseEnv);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-production-smoke-'));
  const tlsDir = path.join(dir, 'tls');
  const releaseDir = path.join(dir, 'release');
  const dbPath = path.join(dir, 'server', 'data', 'last-training.db');
  const backupDir = path.join(dir, 'server', 'backups');
  const logDir = path.join(dir, 'server', 'logs');
  const keyPath = path.join(tlsDir, 'smoke.key');
  const certPath = path.join(tlsDir, 'smoke.crt');
  const updateKeyPath = path.join(dir, 'update.key');
  const envPath = path.join(dir, '.env');
  const installerName = 'Last Training Setup 1.2.3.exe';
  const installerPath = path.join(releaseDir, installerName);
  for (const folder of [tlsDir, releaseDir, path.dirname(dbPath), backupDir, logDir]) {
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  }

  let app = null;
  let feedServer = null;

  try {
    const apiPort = await freePort();
    let feedPort = await freePort();
    while (feedPort === apiPort) feedPort = await freePort();
    const origin = `https://127.0.0.1:${apiPort}`;
    const feedOrigin = `https://127.0.0.1:${feedPort}`;
    const identity = 'smoke@lasttraining.local';
    const password = 'SmokeProducao2026!';
    const deviceId = crypto.randomUUID();
    const jwtSecret = `smoke-${crypto.randomBytes(32).toString('hex')}`;

    await step('certificado TLS', async () => {
      const pems = await selfsigned.generate(
        [
          { name: 'commonName', value: '127.0.0.1' },
          { name: 'organizationName', value: 'Last Training Smoke' }
        ],
        {
          days: 1,
          keySize: 2048,
          algorithm: 'sha256',
          extensions: [
            {
              name: 'subjectAltName',
              altNames: [
                { type: 2, value: 'localhost' },
                { type: 7, value: '127.0.0.1' }
              ]
            },
            { name: 'basicConstraints', cA: true, critical: true },
            { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, keyCertSign: true }
          ]
        }
      );
      fs.writeFileSync(keyPath, pems.private, { mode: 0o600 });
      fs.writeFileSync(certPath, pems.cert, { mode: 0o644 });
      return 'TLS local com SAN para 127.0.0.1';
    });

    const publicKey = await step('chave Ed25519', async () => {
      const pair = crypto.generateKeyPairSync('ed25519');
      fs.writeFileSync(updateKeyPath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
      const encoded = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      return encoded;
    });

    const envValues = {
      LT_ENV: 'production',
      LT_SERVER_HOST: '127.0.0.1',
      LT_SERVER_PORT: String(apiPort),
      LT_BASE_URL: origin,
      LT_AUTH_API_BASE_URL: origin,
      LT_PUBLIC_ORIGIN: origin,
      LT_DB_PATH: dbPath,
      AUTH_JWT_SECRET: jwtSecret,
      LT_TLS_KEY: keyPath,
      LT_TLS_CERT: certPath,
      LT_TLS_TERMINATED: 'false',
      LT_TRUST_PROXY: 'false',
      LT_UPDATE_URL: feedOrigin,
      LT_UPDATE_PUBLIC_KEY: publicKey,
      LT_BACKUP_DIR: backupDir,
      LT_BACKUP_RETENTION: '2',
      LT_LOG_DIR: logDir
    };

    await step('ambiente de produção sintético', () => {
      writeEnv(envPath, envValues);
      Object.assign(process.env, envValues);
      return `${origin} / ${feedOrigin}`;
    });

    await step('instalador de teste', () => {
      fs.writeFileSync(installerPath, Buffer.from(`Last Training smoke installer\n${Date.now()}\n`.repeat(64)));
      return installerName;
    });

    const feedManifest = await step('assinatura do feed', () => {
      execFileSync(process.execPath, [
        path.join(root, 'scripts', 'sign-update.mjs'),
        '--version', '1.2.3',
        '--dir', releaseDir,
        '--key-path', updateKeyPath,
        '--base', feedOrigin,
        installerName
      ], { cwd: root, env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'] });

      const manifestPath = path.join(releaseDir, 'latest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      verifySignedManifest(manifest, publicKey);
      const hash = crypto.createHash('sha512').update(fs.readFileSync(installerPath)).digest('hex');
      if (manifest.files[0].sha512 !== hash) throw new Error('SHA-512 do manifesto não confere');
      return manifest.version;
    });

    await step('seed do banco isolado', () => {
      const { seed } = require('../server/scripts/seed');
      seed({ dbPath, identity, password, display: 'Smoke Olivia', plan: 'pro', status: 'active' });
      return path.relative(root, dbPath);
    });

    await step('API HTTPS', async () => {
      const { listen } = require('../server/index');
      app = await listen();
      if (!app.tls) throw new Error('servidor não iniciou com TLS');
      return `${origin} /admin`;
    });

    feedServer = https.createServer(
      { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
      async (request, response) => {
        const name = decodeURIComponent(new URL(request.url, feedOrigin).pathname).replace(/^\/+/, '') || 'latest.json';
        const file = path.resolve(releaseDir, name);
        if (!file.startsWith(`${releaseDir}${path.sep}`) || !fs.existsSync(file)) {
          response.writeHead(404, { 'content-type': 'application/json' });
          response.end('{"error":"NOT_FOUND"}');
          return;
        }
        response.writeHead(200, {
          'content-type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream',
          'content-length': fs.statSync(file).size,
          'cache-control': 'no-store'
        });
        fs.createReadStream(file).pipe(response);
      }
    );
    await step('feed HTTPS', async () => {
      const port = await listen(feedServer, feedPort);
      if (port !== feedPort) throw new Error(`porta do feed mudou: ${port} != ${feedPort}`);
      return feedOrigin;
    });

    await step('/health real', async () => {
      const response = await httpsRequest(`${origin}/health`, { ca: certPath });
      const payload = response.json();
      if (response.status !== 200 || payload.ok !== true) throw new Error(`HTTP ${response.status} / ${payload.status}`);
      if (payload.checks.database.ok !== true) throw new Error('quick_check falhou');
      return `${payload.status} / ${payload.counts.accounts} conta`;
    });

    await step('/admin com CSP', async () => {
      const response = await httpsRequest(`${origin}/admin`, { ca: certPath });
      const csp = String(response.headers['content-security-policy'] || '');
      if (response.status !== 200 || !csp.includes("default-src 'self'")) throw new Error(`HTTP ${response.status} / CSP ausente`);
      return '200 / CSP rígida';
    });

    await step('login HTTPS real', async () => {
      const response = await httpsRequest(`${origin}/v1/auth/login`, {
        method: 'POST',
        ca: certPath,
        headers: { 'x-request-id': crypto.randomUUID() },
        body: JSON.stringify({
          identity,
          password,
          device: { id: deviceId, name: 'smoke-production', hwid: 'hwid-smoke-production' }
        })
      });
      const payload = response.json();
      if (response.status !== 200 || payload.data?.license?.status !== 'active') {
        throw new Error(`${response.status} / ${payload.error?.code || 'sem licença ativa'}`);
      }
      verify(payload.data.token, app.config.jwtSecret, 'access');
      const device = app.db.prepare('SELECT ip, hwid FROM devices WHERE id = ?').get(deviceId);
      if (device?.hwid !== 'hwid-smoke-production') throw new Error('HWID não persistido');
      return 'token access válido / licença ativa / HWID gravado';
    });

    await step('verificação do feed pelo cliente', async () => {
      const manifest = await fetchSignedManifest(feedOrigin, publicKey, makeFetch(fs.readFileSync(certPath)));
      if (manifest.version !== feedManifest) throw new Error('versão divergente');
      const installer = await httpsRequest(manifest.files[0].url, { ca: certPath });
      const hash = crypto.createHash('sha512').update(installer.bytes).digest('hex');
      if (installer.status !== 200 || hash !== manifest.files[0].sha512) throw new Error('download ou hash divergente');
      return `${manifest.version} / SHA-512 conferido`;
    });

    await step('preflight --production', async () => {
      let stdout;
      let stderr;
      try {
        ({ stdout, stderr } = await execFileAsync(process.execPath, [
          path.join(root, 'scripts', 'preflight.js'),
          '--production',
          `--env=${envPath}`,
          `--url=${origin}`
        ], {
          cwd: root,
          env: { ...baseEnv, NODE_EXTRA_CA_CERTS: certPath },
          timeout: 30000,
          maxBuffer: 2 * 1024 * 1024
        }));
      } catch (error) {
        throw new Error(error.stderr?.trim() || error.stdout?.trim() || error.message);
      }
      const report = JSON.parse(stdout);
      const failures = report.checks.filter(item => item.status === 'fail');
      if (!report.ok || failures.length) throw new Error(failures.map(item => `${item.name}: ${item.detail}`).join('; ') || 'preflight não aprovou');
      return `${report.status} / ${report.checks.length} checks`;
    });
  } finally {
    await close(feedServer);
    if (app) {
      await close(app.service);
      try { app.db.close(); } catch {}
    }
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }); }
    catch {}
  }
}

main()
  .catch(error => {
    if (!checks.some(item => item.status === 'fail')) {
      checks.push({ name: 'smoke', status: 'fail', detail: error?.message || String(error) });
      failed = true;
    }
  })
  .finally(() => {
    const report = { ok: !failed, status: failed ? 'fail' : 'ok', checks };
    console.log(JSON.stringify(report, null, 2));
    if (failed) process.exitCode = 1;
  });

module.exports = { cleanEnvironment, envLine, httpsRequest, makeFetch };
