'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { verifySignedManifest } = require('../src/main/update/signature');

const root = path.join(__dirname, '..');
const execFileAsync = promisify(execFile);
const isWindows = process.platform === 'win32';
const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const builderCli = path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function parse(argv) {
  const options = { unsigned: false, clean: false, skipIcon: false, skipBuild: false, skipUpdateSign: false, allowUntrustedSignature: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--unsigned') options.unsigned = true;
    else if (token === '--clean') options.clean = true;
    else if (token === '--skip-icon') options.skipIcon = true;
    else if (token === '--skip-build') options.skipBuild = true;
    else if (token === '--skip-update-sign') options.skipUpdateSign = true;
    else if (token === '--allow-untrusted-signature') options.allowUntrustedSignature = true;
    else if (token.startsWith('--')) {
      const separator = token.indexOf('=');
      const key = separator === -1 ? token.slice(2) : token.slice(2, separator);
      const inlineValue = separator === -1 ? null : token.slice(separator + 1);
      const next = argv[index + 1];
      if (inlineValue !== null) options[key] = inlineValue;
      else if (next && !next.startsWith('--')) {
        options[key] = next;
        index += 1;
      } else {
        options[key] = true;
      }
    }
  }
  if (process.env.LT_ALLOW_UNTRUSTED_SIGNATURE === 'true') options.allowUntrustedSignature = true;
  return options;
}

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      cwd: options.cwd || root,
      env: options.env || process.env,
      shell: Boolean(options.shell),
      encoding: 'utf8',
      timeout: options.timeout || 15 * 60 * 1000,
      maxBuffer: 16 * 1024 * 1024
    });
  } catch (error) {
    const tail = [error.stderr, error.stdout].filter(Boolean).join('\n').trim().slice(-6000);
    throw new Error(`${error.message}${tail ? `\n${tail}` : ''}`);
  }
}

function credential(options) {
  if (options.unsigned) return { enabled: false };
  const link = options.cert || process.env.WIN_CSC_LINK || process.env.CSC_LINK || '';
  const password = options.password || process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD || '';
  if (!link) return { enabled: false, missing: 'WIN_CSC_LINK' };
  return {
    enabled: true,
    publisher: options.publisher || process.env.LT_PUBLISHER_NAME || '',
    env: {
      WIN_CSC_LINK: link,
      WIN_CSC_KEY_PASSWORD: password,
      CSC_LINK: link,
      CSC_KEY_PASSWORD: password
    }
  };
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function verifyAuthenticode(file, options = {}) {
  const script = [
    '$s = Get-AuthenticodeSignature -LiteralPath ' + powershellQuote(file),
    '@{ status = [string]$s.Status; signer = $(if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { "" }); message = [string]$s.StatusMessage } | ConvertTo-Json -Compress'
  ].join('; ');
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command', script]);
  const signature = JSON.parse(stdout.trim());
  const accepted = options.allowUntrustedSignature
    ? new Set(['Valid', 'UnknownError'])
    : new Set(['Valid']);
  if (!accepted.has(signature.status)) throw new Error(`assinatura ${signature.status}`);
  if (!signature.signer) throw new Error('assinatura sem signatário');
  return signature;
}

function findInstaller(directory, after) {
  return fs.readdirSync(directory)
    .filter(name => /\.exe$/i.test(name) && !/uninstall/i.test(name))
    .map(name => ({ name, file: path.join(directory, name), stat: fs.statSync(path.join(directory, name)) }))
    .filter(item => item.stat.size > 1024 * 1024 && item.stat.mtimeMs >= after)
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0] || null;
}

async function release(options) {
  const report = {
    ok: false,
    status: 'fail',
    version: options.version || packageJson.version,
    installer: null,
    signature: null,
    update: null,
    held: [],
    checks: []
  };
  const releaseDir = path.resolve(options.out || path.join(root, 'release'));
  const startedAt = Date.now() - 2000;
  const sign = credential(options);
  let failed = false;

  async function step(name, action) {
    try {
      const detail = await action();
      report.checks.push({ name, status: 'ok', detail: detail || '' });
      return detail;
    } catch (error) {
      report.checks.push({ name, status: 'fail', detail: error?.message || String(error) });
      failed = true;
      throw error;
    }
  }

  try {
    if (options.clean) {
      await step('limpar release', () => {
        fs.rmSync(releaseDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
        return path.relative(root, releaseDir);
      });
    }
    fs.mkdirSync(releaseDir, { recursive: true });

    if (!options.skipIcon) {
      await step('ícone', async () => {
        await run(process.execPath, [npmCli, 'run', 'icon']);
        return 'build/icon.ico';
      });
    }

    if (!options.skipBuild) {
      await step('build do app', async () => {
        await run(process.execPath, [npmCli, 'run', 'build']);
        return 'dist + integridade';
      });
    }

    if (isWindows) {
      await step('winCodeSign cache', async () => {
        const { stdout } = await run(process.execPath, [path.join(root, 'scripts', 'prepare-win-code-sign.js')]);
        return JSON.parse(stdout.trim()).detail;
      });
    }

    await step('installer NSIS', async () => {
      const args = ['--win', '--x64', '--publish', 'never', `-c.directories.output=${releaseDir}`];
      if (sign.enabled) {
        args.push('-c.forceCodeSigning=true', '-c.win.verifyUpdateCodeSignature=true');
        if (sign.publisher) args.push(`-c.win.publisherName=${sign.publisher}`);
      } else {
        args.push('-c.win.verifyUpdateCodeSignature=false');
      }
      await run(process.execPath, [builderCli, ...args], {
        env: { ...process.env, ...(sign.env || {}) }
      });
      return path.relative(root, releaseDir);
    });

    report.installer = await step('seleção do instalador', () => {
      const found = findInstaller(releaseDir, startedAt);
      if (!found) throw new Error('nenhum .exe de installer encontrado em release/');
      return found.name;
    });

    const installerFile = path.join(releaseDir, report.installer);

    if (sign.enabled) {
      report.signature = await step('Authenticode', async () => {
        return verifyAuthenticode(installerFile, options);
      });
    } else {
      report.held.push('WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD (Authenticode)');
    }

    const updateKeyPath = options['update-key-path'] || process.env.LT_UPDATE_PRIVATE_KEY_PATH || '';
    const updateKey = process.env.LT_UPDATE_PRIVATE_KEY || '';
    const updateBase = options['update-base'] || process.env.LT_UPDATE_URL || '';

    if (options.skipUpdateSign) {
      report.held.push('assinatura do feed pulada por --skip-update-sign');
    } else if (!updateKeyPath && !updateKey) {
      report.held.push('LT_UPDATE_PRIVATE_KEY_PATH ou LT_UPDATE_PRIVATE_KEY (feed assinado)');
    } else if (!updateBase || !/^https:\/\//i.test(updateBase)) {
      report.held.push('LT_UPDATE_URL HTTPS (feed assinado)');
    } else {
      report.update = await step('feed assinado', async () => {
        const publicPath = path.join(releaseDir, 'update.public.pem');
        const args = [
          path.join(root, 'scripts', 'sign-update.mjs'),
          '--version', report.version,
          '--dir', releaseDir,
          '--base', updateBase,
          '--emit-public', publicPath,
          report.installer
        ];
        if (updateKeyPath) args.push('--key-path', updateKeyPath);
        else args.push('--key', updateKey);
        await run(process.execPath, args);

        const manifest = JSON.parse(fs.readFileSync(path.join(releaseDir, 'latest.json'), 'utf8'));
        verifySignedManifest(manifest, fs.readFileSync(publicPath, 'utf8'));
        const hash = crypto.createHash('sha512').update(fs.readFileSync(installerFile)).digest('hex');
        if (manifest.files[0].sha512 !== hash) throw new Error('SHA-512 do instalador divergente');
        return { version: manifest.version, publicKey: path.relative(root, publicPath), files: manifest.files.length };
      });
    }

    report.ok = !failed;
    report.status = failed ? 'fail' : report.held.length ? 'warn' : 'ok';
    return report;
  } catch {
    report.ok = false;
    report.status = 'fail';
    return report;
  }
}

if (require.main === module) {
  release(parse(process.argv.slice(2)))
    .then(report => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
    })
    .catch(error => {
      console.error(error?.message || String(error));
      process.exit(1);
    });
}

module.exports = { parse, credential, findInstaller, verifyAuthenticode, release };
