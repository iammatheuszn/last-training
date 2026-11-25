'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifySignedManifest } = require('../src/main/update/signature');

const root = path.join(__dirname, '..');
const checks = [];
let failed = false;

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const separator = token.indexOf('=');
    const key = separator === -1 ? token.slice(2) : token.slice(2, separator);
    const inline = separator === -1 ? null : token.slice(separator + 1);
    const next = argv[index + 1];
    if (inline !== null) options[key] = inline;
    else if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
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

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function digest(file, algorithm) {
  return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function assertNoSecrets(dir) {
  for (const file of walk(dir)) {
    const name = path.basename(file).toLowerCase();
    assert(name !== '.env', `.env não permitido no bundle: ${file}`);
    assert(!['.pfx', '.p12', '.key'].some(extension => name.endsWith(extension)), `chave ou certificado privado no bundle: ${file}`);
    if (name.endsWith('.pem')) {
      assert(name === 'update.public.pem', `PEM inesperado no bundle: ${file}`);
      const text = fs.readFileSync(file, 'utf8');
      assert(text.includes('BEGIN PUBLIC KEY'), `PEM não público: ${file}`);
    }
    const textLike = ['.json', '.yml', '.yaml', '.txt', '.md', '.conf', '.example', '.pem']
      .some(extension => name.endsWith(extension));
    if (!textLike) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert(!/-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/i.test(text), `chave privada embutida: ${file}`);
  }
}

function writeManifest(dir) {
  const files = walk(dir)
    .filter(file => path.basename(file) !== 'manifest.json')
    .map(file => path.relative(dir, file).replace(/\\/g, '/'))
    .sort();
  const manifest = {
    version: 1,
    kind: 'last-training-deploy-bundle',
    createdAt: new Date().toISOString(),
    files: {}
  };
  for (const name of files) {
    manifest.files[name] = {
      sha256: hashFile(path.join(dir, name)),
      size: fs.statSync(path.join(dir, name)).size
    };
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  return Object.keys(manifest.files).length;
}

function verifyManifest(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(manifest?.version === 1 && manifest.kind === 'last-training-deploy-bundle' && manifest.files, 'manifesto do bundle inválido');
  for (const [name, expected] of Object.entries(manifest.files)) {
    assert(/^[\w./ -]+$/.test(name) && !name.includes('..'), `entrada inválida no manifesto: ${name}`);
    assert(/^[a-f0-9]{64}$/.test(expected?.sha256 || ''), `hash inválido no manifesto: ${name}`);
    const file = path.join(dir, name);
    assert(fs.existsSync(file), `arquivo ausente no bundle: ${name}`);
    assert(hashFile(file) === expected.sha256, `hash divergente: ${name}`);
    assert(fs.statSync(file).size === expected.size, `tamanho divergente: ${name}`);
  }
  return Object.keys(manifest.files).length;
}

async function createBundle(options) {
  const report = { ok: false, status: 'fail', version: '', installer: '', apiBase: '', updateBase: '', out: '', checks };
  const releaseDir = path.resolve(options.release || path.join(root, 'release'));
  const out = path.resolve(options.out || path.join(releaseDir, 'bundle'));
  const apiBase = String(options['api-base'] || process.env.LT_AUTH_API_BASE_URL || process.env.LT_BASE_URL || '').replace(/\/+$/, '');
  let staging = '';

  try {
    await step('endpoint HTTPS', () => {
      assert(/^https:\/\//i.test(apiBase), 'runtime exige LT_AUTH_API_BASE_URL ou --api-base HTTPS');
      report.apiBase = apiBase;
      return apiBase;
    });

    const feed = await step('feed assinado', () => {
      const manifestPath = path.join(releaseDir, 'latest.json');
      const keyPath = path.join(releaseDir, 'update.public.pem');
      assert(fs.existsSync(manifestPath), 'latest.json ausente no release');
      assert(fs.existsSync(keyPath), 'update.public.pem ausente no release');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const publicKey = fs.readFileSync(keyPath, 'utf8');
      verifySignedManifest(manifest, publicKey);
      assert(manifest.files.length === 1, 'feed com mais de um arquivo');
      const file = manifest.files[0];
      assert(/^https:\/\//i.test(file.url), 'URL do instalador não é HTTPS');
      assert(path.basename(file.name) === file.name && !file.name.includes('..'), 'nome de instalador inseguro');
      report.version = manifest.version;
      report.installer = file.name;
      report.updateBase = new URL(file.url).origin;
      return `${manifest.version} / ${file.name} / assinatura ok`;
    });

    const installerPath = path.join(releaseDir, report.installer);
    await step('instalador íntegro', () => {
      assert(fs.existsSync(installerPath), `instalador ausente: ${report.installer}`);
      const manifest = JSON.parse(fs.readFileSync(path.join(releaseDir, 'latest.json'), 'utf8'));
      const entry = manifest.files[0];
      const sha512 = digest(installerPath, 'sha512');
      assert(sha512 === entry.sha512.toLowerCase(), 'SHA-512 do instalador divergente');
      assert(fs.statSync(installerPath).size === entry.size, 'tamanho do instalador divergente');
      const yml = fs.readFileSync(path.join(releaseDir, 'latest.yml'), 'utf8');
      assert(yml.includes(crypto.createHash('sha512').update(fs.readFileSync(installerPath)).digest('base64')), 'latest.yml divergente');
      if (options['update-base']) {
        const requested = String(options['update-base']).replace(/\/+$/, '');
        assert(/^https:\/\//i.test(requested), '--update-base precisa ser HTTPS');
        assert(entry.url.startsWith(`${requested}/`), 'URL do feed não corresponde a --update-base');
        report.updateBase = requested;
      }
      return `${entry.size} bytes / sha512 ok / latest.yml ok`;
    });

    staging = path.join(os.tmpdir(), `lt-bundle-${crypto.randomUUID()}`);
    fs.mkdirSync(staging, { recursive: true, mode: 0o700 });

    await step('estágio do bundle', () => {
      const copy = (from, to) => {
        fs.mkdirSync(path.dirname(path.join(staging, to)), { recursive: true });
        fs.copyFileSync(from, path.join(staging, to), fs.constants.COPYFILE_FICLONE);
      };
      copy(installerPath, `updates/${report.installer}`);
      copy(path.join(releaseDir, 'latest.json'), 'updates/latest.json');
      copy(path.join(releaseDir, 'latest.yml'), 'updates/latest.yml');
      copy(path.join(releaseDir, 'update.public.pem'), 'updates/update.public.pem');
      copy(path.join(root, '.env.example'), 'server/.env.example');
      copy(path.join(root, 'deploy', 'Caddyfile'), 'server/Caddyfile');
      copy(path.join(root, 'deploy', 'nginx.conf'), 'server/nginx.conf');
      copy(path.join(root, 'deploy', 'README.md'), 'server/README.md');
      fs.mkdirSync(path.join(staging, 'config'), { recursive: true });
      fs.writeFileSync(
        path.join(staging, 'config', 'runtime.json'),
        `${JSON.stringify({ authApiBaseUrl: apiBase }, null, 2)}\n`,
        { mode: 0o644 }
      );
      fs.writeFileSync(
        path.join(staging, 'README.txt'),
        [
          'Last Training — pacote de deploy',
          `Versão: ${report.version}`,
          `API: ${report.apiBase}`,
          `Updates: ${report.updateBase}`,
          '',
          'updates/  -> publicar no host HTTPS de updates (installer, latest.json, latest.yml, chave pública).',
          'config/   -> runtime.json aponta o cliente para a API; LT_AUTH_API_BASE_URL tem precedência.',
          'server/   -> modelos de proxy, .env.example e o guia de operação.',
          'manifest.json -> SHA-256 e tamanho de todos os arquivos do bundle.',
          '',
          'Nenhuma chave privada, PFX, senha ou .env entra neste pacote.',
          ''
        ].join('\n'),
        { mode: 0o644 }
      );
      return 'updates/ + config/ + server/ + README.txt';
    });

    await step('varredura de segredos', () => {
      assertNoSecrets(staging);
      return 'sem .env, PFX, .key ou chave privada PEM';
    });

    await step('manifesto do bundle', () => {
      const count = writeManifest(staging);
      const verified = verifyManifest(staging);
      assert(count === verified, `contagem divergente: ${count} != ${verified}`);
      return `${verified} arquivos com SHA-256 conferido`;
    });

    await step('publicação do bundle', () => {
      const backup = path.join(os.tmpdir(), `lt-bundle-old-${crypto.randomUUID()}`);
      if (fs.existsSync(out)) fs.renameSync(out, backup);
      try {
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.renameSync(staging, out);
      } finally {
        if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
      }
      report.out = out;
      return path.relative(root, out);
    });

    await step('verificação final', () => {
      const count = verifyManifest(out);
      assertNoSecrets(out);
      const runtime = JSON.parse(fs.readFileSync(path.join(out, 'config', 'runtime.json'), 'utf8'));
      assert(runtime.authApiBaseUrl === apiBase, 'runtime.json divergente');
      return `${count} arquivos / runtime ${apiBase}`;
    });

    report.ok = true;
    report.status = 'ok';
    return report;
  } catch {
    report.status = 'fail';
    if (staging && fs.existsSync(staging)) {
      fs.rmSync(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    }
    return report;
  }
}

if (require.main === module) {
  createBundle(parse(process.argv.slice(2)))
    .then(report => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
    })
    .catch(error => {
      console.error(error?.message || String(error));
      process.exit(1);
    });
}

module.exports = { createBundle, parse, verifyManifest, assertNoSecrets };
