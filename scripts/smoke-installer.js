'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const asar = require('@electron/asar');
const { findInstaller } = require('./release');
const { verify } = require('../src/main/security/integrity');

const execFileAsync = promisify(execFile);
const root = path.join(__dirname, '..');
const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const separator = token.indexOf('=');
    const key = separator === -1 ? token.slice(2) : token.slice(2, separator);
    const value = separator === -1 ? argv[index + 1] : token.slice(separator + 1);
    if (!token.startsWith('--')) continue;
    options[key] = value && !value.startsWith('--') ? value : true;
    if (separator === -1 && options[key] !== true) index += 1;
  }
  return options;
}

async function waitForRemoval(file, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!fs.existsSync(file)) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return !fs.existsSync(file);
}

async function runChecks(options) {
  const checks = [];
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-install-smoke-'));
  const releaseDir = path.join(temp, 'release');
  const installDir = path.join(temp, 'installed');
  const extractedDir = path.join(temp, 'extracted');
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
    let installerFile = options.installer ? path.resolve(options.installer) : null;
    const startedAt = Date.now() - 2000;

    if (!installerFile) {
      await step('installer NSIS', async () => {
        let stdout;
        let stderr;
        try {
          ({ stdout, stderr } = await execFileAsync(process.execPath, [
            npmCli, 'run', 'dist:unsigned', '--',
            '--clean', '--skip-update-sign', `--out=${releaseDir}`
          ], {
            cwd: root,
            encoding: 'utf8',
            timeout: 15 * 60 * 1000,
            maxBuffer: 16 * 1024 * 1024
          }));
        } catch (error) {
          const tail = [error.stderr, error.stdout].filter(Boolean).join('\n').trim();
          throw new Error(`${error.message}${tail ? `\n${tail.slice(-6000)}` : ''}`);
        }
        const found = findInstaller(releaseDir, startedAt);
        if (!found) throw new Error('nenhum installer gerado');
        installerFile = found.file;
        return found.name;
      });
    }

    if (!fs.existsSync(installerFile)) throw new Error(`installer não encontrado: ${installerFile}`);

    await step('instalação silenciosa', async () => {
      fs.mkdirSync(installDir, { recursive: true });
      await execFileAsync(installerFile, ['/S', `/D=${installDir}`], {
        cwd: temp,
        timeout: 5 * 60 * 1000,
        maxBuffer: 8 * 1024 * 1024
      });
      if (!fs.existsSync(path.join(installDir, 'Last Training.exe'))) {
        throw new Error('Last Training.exe não apareceu após /S');
      }
      return path.relative(root, installDir);
    });

    let uninstallerName;
    await step('arquivos instalados', () => {
      const uninstaller = fs.readdirSync(installDir).find(name => /^Uninstall .+\.exe$/i.test(name));
      uninstallerName = uninstaller;
      const required = [
        'Last Training.exe',
        'resources/app.asar',
        'resources.pak',
        'icudtl.dat',
        'locales/en-US.pak',
        ...(uninstaller ? [uninstaller] : [])
      ];
      const missing = required.filter(name => !fs.existsSync(path.join(installDir, name)));
      if (missing.length) throw new Error(`ausentes: ${missing.join(', ')}`);
      if (!uninstaller) throw new Error('uninstaller não encontrado');
      return `${required.length} arquivos / ${uninstaller}`;
    });

    await step('integridade do pacote', async () => {
      const archive = path.join(installDir, 'resources', 'app.asar');
      const packageFiles = asar.listPackage(archive);
      const required = ['dist/integrity.json', 'dist/index.html', 'src/main/index.js', 'src/preload/api.js'];
      const normalized = packageFiles.map(name => name.replace(/\\/g, '/').replace(/^\//, ''));
      const missing = required.filter(name => !normalized.includes(name));
      if (missing.length) throw new Error(`ausentes no asar: ${missing.join(', ')}`);
      await asar.extractAll(archive, extractedDir);
      const result = verify(path.join(extractedDir, 'dist'));
      if (!result.ok) throw new Error(`${result.reason} (${result.checked} arquivos)`);
      return `${result.checked} arquivos verificados`;
    });

    await step('desinstalação silenciosa', async () => {
      await execFileAsync(path.join(installDir, uninstallerName), ['/S'], {
        cwd: installDir,
        timeout: 3 * 60 * 1000,
        maxBuffer: 8 * 1024 * 1024
      });
      if (!await waitForRemoval(path.join(installDir, 'Last Training.exe'))) {
        throw new Error('Last Training.exe permaneceu após desinstalação');
      }
      return 'removido';
    });

    return {
      ok: !failed,
      status: failed ? 'fail' : 'ok',
      installer: path.basename(installerFile),
      checks
    };
  } catch {
    return { ok: false, status: 'fail', checks };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
}

if (require.main === module) {
  runChecks(parse(process.argv.slice(2)))
    .then(report => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
    })
    .catch(error => {
      console.error(error?.message || String(error));
      process.exit(1);
    });
}

module.exports = { runChecks, parse, waitForRemoval };
