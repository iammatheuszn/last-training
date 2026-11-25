'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const root = path.join(__dirname, '..');
const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const apiBase = 'https://app.lasttraining.local';
const updateBase = 'https://updates.lasttraining.local';

function parseReport(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('relatório JSON ausente');
  return JSON.parse(stdout.slice(start, end + 1));
}

async function runChecks() {
  const checks = [];
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-bundle-smoke-'));
  const releaseDir = path.join(temp, 'release');
  const bundleDir = path.join(temp, 'bundle');
  const keyPath = path.join(temp, 'update.key');
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
    await step('chave Ed25519', () => {
      const pair = crypto.generateKeyPairSync('ed25519');
      fs.writeFileSync(keyPath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
      return 'par temporária gerada';
    });

    await step('release sintético', async () => {
      let stdout;
      let stderr;
      try {
        ({ stdout, stderr } = await execFileAsync(process.execPath, [
          npmCli, 'run', 'dist:unsigned', '--',
          '--clean',
          `--out=${releaseDir}`,
          `--update-base=${updateBase}`,
          `--update-key-path=${keyPath}`
        ], {
          cwd: root,
          encoding: 'utf8',
          timeout: 15 * 60 * 1000,
          maxBuffer: 16 * 1024 * 1024
        }));
      } catch (error) {
        const tail = [error.stderr, error.stdout, stderr, stdout].filter(Boolean).join('\n').trim();
        throw new Error(`${error.message}${tail ? `\n${tail.slice(-6000)}` : ''}`);
      }
      const report = parseReport(stdout);
      if (!report.ok) throw new Error(report.checks.filter(item => item.status === 'fail').map(item => `${item.name}: ${item.detail}`).join('; '));
      return `${report.installer} / ${report.status}`;
    });

    const bundled = await step('bundle gerado', async () => {
      let stdout;
      let stderr;
      try {
        ({ stdout, stderr } = await execFileAsync(process.execPath, [
          path.join(root, 'scripts', 'bundle.js'),
          `--release=${releaseDir}`,
          `--out=${bundleDir}`,
          `--api-base=${apiBase}`,
          `--update-base=${updateBase}`
        ], {
          cwd: root,
          encoding: 'utf8',
          timeout: 5 * 60 * 1000,
          maxBuffer: 16 * 1024 * 1024
        }));
      } catch (error) {
        const tail = [error.stderr, error.stdout, stderr, stdout].filter(Boolean).join('\n').trim();
        throw new Error(`${error.message}${tail ? `\n${tail.slice(-6000)}` : ''}`);
      }
      const report = parseReport(stdout);
      if (!report.ok) throw new Error(report.checks.filter(item => item.status === 'fail').map(item => `${item.name}: ${item.detail}`).join('; '));
      return `${report.version} / ${report.checks.length} checks`;
    });

    await step('conteúdo do bundle', () => {
      const required = [
        'README.txt',
        'manifest.json',
        'config/runtime.json',
        'server/.env.example',
        'server/Caddyfile',
        'server/nginx.conf',
        'server/README.md',
        'updates/latest.json',
        'updates/latest.yml',
        'updates/update.public.pem'
      ];
      const missing = required.filter(name => !fs.existsSync(path.join(bundleDir, name)));
      if (missing.length) throw new Error(`ausentes: ${missing.join(', ')}`);
      const installers = fs.readdirSync(path.join(bundleDir, 'updates')).filter(name => /\.exe$/i.test(name));
      if (installers.length !== 1) throw new Error(`installers no bundle: ${installers.length}`);
      return `${required.length + 1} arquivos obrigatórios`;
    });

    await step('hashes do bundle', () => {
      const { verifyManifest } = require('./bundle');
      const count = verifyManifest(bundleDir);
      const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'manifest.json'), 'utf8'));
      const forbidden = Object.keys(manifest.files).filter(name => /(^|\/)(?:\.env|.*\.pfx|.*\.p12|.*\.key|update\.key)$/i.test(name));
      if (forbidden.length) throw new Error(`segredos no manifesto: ${forbidden.join(', ')}`);
      const runtime = JSON.parse(fs.readFileSync(path.join(bundleDir, 'config', 'runtime.json'), 'utf8'));
      if (runtime.authApiBaseUrl !== apiBase) throw new Error('runtime.json divergente');
      return `${count} hashes conferidos / runtime HTTPS`;
    });

    return { ok: !failed, status: failed ? 'fail' : 'ok', bundle: bundled, checks };
  } catch {
    return { ok: false, status: 'fail', checks };
  } finally {
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
