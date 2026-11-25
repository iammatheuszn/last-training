'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');

function parseArgs(argv) {
  const args = { command: argv[0] || 'create' };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function resolvePaths(args) {
  const dbPath = path.resolve(args.dbPath || args.db || process.env.LT_DB_PATH || path.join(root, 'server', 'data', 'last-training.db'));
  const dir = path.resolve(args.dir || process.env.LT_BACKUP_DIR || path.join(root, 'server', 'backups'));
  const keep = Number(args.keep || process.env.LT_BACKUP_RETENTION || 7);
  if (!Number.isInteger(keep) || keep < 1 || keep > 365) {
    throw new Error('--keep/LT_BACKUP_RETENTION deve ser um inteiro entre 1 e 365');
  }
  return { dbPath, dir, keep };
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function checkpoint(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const rows = db.prepare('PRAGMA integrity_check').all();
    const ok = rows.length === 1 && String(rows[0].integrity_check).toLowerCase() === 'ok';
    if (!ok) throw new Error('integrity_check falhou no banco ativo');
  } finally {
    db.close();
  }
}

function manifestFor(dirPath, files, label) {
  const manifest = {
    version: 1,
    kind: 'last-training-sqlite-backup',
    label: label || 'manual',
    createdAt: new Date().toISOString(),
    database: 'last-training.db',
    files: {}
  };
  for (const file of files) {
    const name = path.basename(file);
    manifest.files[name] = { sha256: hashFile(file), size: fs.statSync(file).size };
  }
  fs.writeFileSync(path.join(dirPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}

function prune(dir, keep) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'manifest.json')))
    .sort((a, b) => b.name.localeCompare(a.name));
  const removed = [];
  for (const entry of entries.slice(keep)) {
    fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

function create(args) {
  const { dbPath, dir, keep } = resolvePaths(args);
  if (!fs.existsSync(dbPath)) throw new Error(`Banco não encontrado: ${dbPath}`);
  checkpoint(dbPath);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `${stamp}-${args.label || 'manual'}`.replace(/[^\w.-]+/g, '-'));
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });

  const files = [];
  const source = dbPath;
  const destination = path.join(target, 'last-training.db');
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_FICLONE);
  fs.chmodSync(destination, 0o600);
  files.push(destination);
  const manifest = manifestFor(target, files, args.label || 'manual');
  const removed = prune(dir, keep);
  return { ok: true, dir: target, files: Object.keys(manifest.files), removed };
}

function backupPath(args) {
  const { dir } = resolvePaths(args);
  if (args.file) return path.resolve(args.file);
  if (!fs.existsSync(dir)) throw new Error('Nenhum backup encontrado');
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'manifest.json')))
    .sort((a, b) => b.name.localeCompare(a.name));
  if (!entries.length) throw new Error('Nenhum backup encontrado');
  return path.join(dir, entries[0].name);
}

function verify(args) {
  const target = backupPath(args);
  const manifestPath = path.join(target, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Manifesto ausente em ${target}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest?.version !== 1 || manifest.kind !== 'last-training-sqlite-backup' || !manifest.files) {
    throw new Error('Manifesto de backup inválido');
  }

  const hashes = [];
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!/^last-training\.db(-wal|-shm)?$/.test(name) || !/^[a-f0-9]{64}$/.test(expected?.sha256 || '')) {
      throw new Error(`Entrada inválida no manifesto: ${name}`);
    }
    const file = path.join(target, name);
    if (!fs.existsSync(file)) throw new Error(`Arquivo ausente no backup: ${name}`);
    if (hashFile(file) !== expected.sha256) throw new Error(`Hash divergente: ${name}`);
    hashes.push(name);
  }

  const source = path.join(target, 'last-training.db');
  const temp = path.join(os.tmpdir(), `lt-backup-verify-${crypto.randomUUID()}.db`);
  fs.copyFileSync(source, temp);
  const db = new DatabaseSync(temp);
  let integrity;
  try {
    const rows = db.prepare('PRAGMA integrity_check').all();
    integrity = rows.length === 1 && String(rows[0].integrity_check).toLowerCase() === 'ok';
  } finally {
    db.close();
    fs.rmSync(temp, { force: true });
  }
  if (!integrity) throw new Error('integrity_check falhou no backup');
  return { ok: true, dir: target, files: hashes, createdAt: manifest.createdAt, integrity: 'ok' };
}

function list(args) {
  const { dir } = resolvePaths(args);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const manifestPath = path.join(dir, entry.name, 'manifest.json');
      if (!fs.existsSync(manifestPath)) return null;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      return {
        dir: path.join(dir, entry.name),
        createdAt: manifest.createdAt,
        label: manifest.label,
        files: Object.keys(manifest.files || {})
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function restore(args) {
  const { dbPath } = resolvePaths(args);
  const target = backupPath(args);
  verify({ ...args, file: target });

  if (fs.existsSync(dbPath) && !args.force) {
    create({ ...args, label: 'pre-restore' });
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  for (const suffix of ['-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  fs.copyFileSync(path.join(target, 'last-training.db'), dbPath);
  fs.chmodSync(dbPath, 0o600);
  checkpoint(dbPath);
  return { ok: true, restoredFrom: target, dbPath };
}

function output(result, json) {
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(JSON.stringify(result, null, 2));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  switch (args.command) {
    case 'create': result = create(args); break;
    case 'verify': result = verify(args); break;
    case 'list': result = list(args); break;
    case 'restore': result = restore(args); break;
    default: throw new Error(`Comando desconhecido: ${args.command}`);
  }
  output(result, Boolean(args.json));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { create, verify, list, restore, parseArgs, resolvePaths };
