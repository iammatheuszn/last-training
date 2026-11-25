'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { verifySignedManifest } = require('../src/main/update/signature');

const execFileAsync = promisify(execFile);
const root = path.join(__dirname, '..');
const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const subject = 'CN=Last Training Release Smoke, O=Last Training, C=BR';
const password = 'lt-release-smoke';
const updateBase = 'https://updates.lasttraining.local';

function parseJson(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('relatório JSON ausente');
  return JSON.parse(stdout.slice(start, end + 1));
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function makeCertificateScript(pfx, cer) {
  return [
    `$subject = ${psQuote(subject)}`,
    `$password = ConvertTo-SecureString ${psQuote(password)} -AsPlainText -Force`,
    '$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $subject -KeyExportPolicy Exportable -KeySpec Signature -KeyLength 2048 -HashAlgorithm SHA256 -CertStoreLocation Cert:\\CurrentUser\\My -NotAfter (Get-Date).AddDays(2)',
    `Export-PfxCertificate -Cert $cert -FilePath ${psQuote(pfx)} -Password $password -Force | Out-Null`,
    `Export-Certificate -Cert $cert -FilePath ${psQuote(cer)} -Force | Out-Null`,
    '@{ thumbprint = [string]$cert.Thumbprint; subject = [string]$cert.Subject } | ConvertTo-Json -Compress'
  ].join('\n');
}

async function removeCertificate(thumbprint) {
  if (!thumbprint) return;
  const script = `$p = 'Cert:\\CurrentUser\\My\\${thumbprint}'; if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }`;
  await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
}

async function runChecks() {
  const checks = [];
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-release-smoke-'));
  const pfx = path.join(temp, 'smoke.pfx');
  const cer = path.join(temp, 'smoke.cer');
  const keyPath = path.join(temp, 'update.key');
  const scriptPath = path.join(temp, 'make-cert.ps1');
  const releaseDir = path.join(temp, 'release');
  let thumbprint = null;
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
    const certificate = await step('certificado code signing', async () => {
      fs.writeFileSync(scriptPath, makeCertificateScript(pfx, cer), 'utf8');
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
      ], { encoding: 'utf8', timeout: 120000 });
      const result = JSON.parse(stdout.trim());
      if (!fs.existsSync(pfx)) throw new Error('PFX não foi exportado');
      thumbprint = result.thumbprint;
      return String(result.subject || '');
    });

    await step('chave Ed25519', () => {
      const pair = crypto.generateKeyPairSync('ed25519');
      fs.writeFileSync(keyPath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
      return 'par temporária gerada';
    });

    let report;
    await step('release assinado', async () => {
      const args = [
        npmCli, 'run', 'dist', '--',
        '--clean',
        '--allow-untrusted-signature',
        `--out=${releaseDir}`,
        `--update-base=${updateBase}`,
        `--update-key-path=${keyPath}`
      ];
      const env = {
        ...process.env,
        WIN_CSC_LINK: pfx,
        WIN_CSC_KEY_PASSWORD: password,
        LT_PUBLISHER_NAME: subject,
        LT_ALLOW_UNTRUSTED_SIGNATURE: 'true'
      };
      let stdout;
      let stderr;
      try {
        ({ stdout, stderr } = await execFileAsync(process.execPath, args, {
          cwd: root,
          encoding: 'utf8',
          timeout: 15 * 60 * 1000,
          maxBuffer: 16 * 1024 * 1024,
          env
        }));
      } catch (error) {
        const tail = [error.stderr, error.stdout, stderr, stdout].filter(Boolean).join('\n').trim();
        throw new Error(`${error.message}${tail ? `\n${tail.slice(-6000)}` : ''}`);
      }
      const result = parseJson(stdout);
      if (!result.ok || result.status !== 'ok') {
        throw new Error(result.checks.filter(item => item.status === 'fail').map(item => `${item.name}: ${item.detail}`).join('; ') || 'release não aprovou');
      }
      report = result;
      return `${result.status} / ${result.checks.length} checks`;
    });

    await step('Authenticode no instalador', () => {
      if (!report.signature?.signer) throw new Error('sem signatário');
      if (!['Valid', 'UnknownError'].includes(report.signature.status)) throw new Error(`status ${report.signature.status}`);
      return `${report.signature.status} / ${report.signature.signer}`;
    });

    await step('feed assinado', () => {
      if (!report.update || report.update.files !== 1) throw new Error('feed ausente');
      const manifest = JSON.parse(fs.readFileSync(path.join(releaseDir, 'latest.json'), 'utf8'));
      const publicKey = fs.readFileSync(path.join(releaseDir, 'update.public.pem'), 'utf8');
      verifySignedManifest(manifest, publicKey);
      const installer = path.join(releaseDir, report.installer);
      const hash = crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('hex');
      if (manifest.files[0].sha512 !== hash) throw new Error('SHA-512 divergente');
      if (manifest.files[0].size !== fs.statSync(installer).size) throw new Error('tamanho divergente');
      if (!/^https:\/\//i.test(manifest.files[0].url)) throw new Error('URL do feed não HTTPS');
      return `${manifest.version} / ${manifest.files.length} arquivo`;
    });

    await step('latest.yml', () => {
      const yml = fs.readFileSync(path.join(releaseDir, 'latest.yml'), 'utf8');
      if (!yml.includes('sha512:') || !yml.includes(updateBase)) throw new Error('manifest legado incompleto');
      return 'sha512 + URL HTTPS presentes';
    });

    return {
      ok: !failed,
      status: failed ? 'fail' : 'ok',
      certificate: certificate,
      installer: report.installer,
      checks
    };
  } catch {
    return { ok: false, status: 'fail', checks };
  } finally {
    await removeCertificate(thumbprint).catch(() => {});
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

module.exports = { runChecks, parseJson, makeCertificateScript };
