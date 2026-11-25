'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const root = path.join(__dirname, '..');
const version = '2.6.0';
const name = `winCodeSign-${version}`;
const url = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${name}/${name}.7z`;
const checksum = '6LQI2d9BPC3Xs0ZoTQe1o3tPiA28c7+PY69Q9i/pD8lY45psMtHuLwv3vRckiVr3Zx1cbNyLlBR8STwCdcHwtA==';

function cacheDirectory() {
  return process.env.ELECTRON_BUILDER_CACHE
    ? path.resolve(process.env.ELECTRON_BUILDER_CACHE)
    : path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || root, 'AppData', 'Local'), 'electron-builder', 'Cache');
}

function sevenZip() {
  try {
    return require('7zip-bin').path7za;
  } catch {
    return path.join(root, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
  }
}

async function downloadArchive(file) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  const actual = require('node:crypto').createHash('sha512').update(body).digest('base64');
  if (actual !== checksum) throw new Error('SHA-512 do winCodeSign divergente');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

async function prepare() {
  if (process.platform !== 'win32') return { status: 'skipped', detail: 'Windows apenas' };

  const parent = path.join(cacheDirectory(), 'winCodeSign');
  const target = path.join(parent, name);
  const archive = path.join(parent, `${name}.7z`);
  const staged = path.join(parent, `${name}.staged`);
  const marker = path.join(target, 'windows-10', 'x64', 'signtool.exe');

  if (fs.existsSync(marker)) return { status: 'ok', detail: path.relative(root, target) };

  fs.mkdirSync(parent, { recursive: true });
  if (!fs.existsSync(archive)) await downloadArchive(archive);

  fs.rmSync(staged, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  fs.mkdirSync(staged, { recursive: true });
  await execFileAsync(sevenZip(), [
    'x', '-bd', '-y', archive, `-o${staged}`,
    '-x!darwin/10.12/lib/libcrypto.dylib',
    '-x!darwin/10.12/lib/libssl.dylib'
  ], { cwd: parent, maxBuffer: 8 * 1024 * 1024 });

  if (!fs.existsSync(path.join(staged, 'windows-10', 'x64', 'signtool.exe'))) {
    fs.rmSync(staged, { recursive: true, force: true });
    throw new Error('winCodeSign extraído sem signtool.exe');
  }

  fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  fs.renameSync(staged, target);
  return { status: 'ok', detail: path.relative(root, target) };
}

prepare()
  .then(result => console.log(JSON.stringify(result)))
  .catch(error => {
    console.error(error?.message || String(error));
    process.exit(1);
  });

module.exports = { prepare, cacheDirectory, version, name, url, checksum };
