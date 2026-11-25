'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');

function parseArgs(argv) {
  const args = { format: 'jsonl', limit: 10000 };
  for (let index = 0; index < argv.length; index += 1) {
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

function csv(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function exportAudit(args) {
  const dbPath = path.resolve(args.db || process.env.LT_DB_PATH || path.join(root, 'server', 'data', 'last-training.db'));
  if (!fs.existsSync(dbPath)) throw new Error(`Banco não encontrado: ${dbPath}`);

  const where = [];
  const params = [];
  if (args.since) { where.push('at >= ?'); params.push(String(args.since)); }
  if (args.until) { where.push('at <= ?'); params.push(String(args.until)); }
  if (args.event && args.event !== true) { where.push('event = ?'); params.push(String(args.event)); }
  if (args.account && args.account !== true) { where.push('account_id = ?'); params.push(String(args.account)); }

  const limit = Number(args.limit || 10000);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200000) {
    throw new Error('--limit deve ser um inteiro entre 1 e 200000');
  }
  params.push(limit);

  const db = new DatabaseSync(dbPath, { readOnly: true });
  let rows;
  try {
    rows = db.prepare(
      `SELECT at, account_id AS accountId, event, detail, ip FROM audit
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY id ASC LIMIT ?`
    ).all(...params);
  } finally {
    db.close();
  }

  const format = String(args.format || 'jsonl');
  if (!['jsonl', 'json', 'csv'].includes(format)) throw new Error('formato inválido');

  let content;
  if (format === 'jsonl') {
    content = rows.map(row => JSON.stringify(row)).join('\n');
  } else if (format === 'json') {
    content = JSON.stringify({ ok: true, exportedAt: new Date().toISOString(), count: rows.length, rows }, null, 2);
  } else {
    content = ['at,accountId,event,detail,ip', ...rows.map(row =>
      [row.at, row.accountId, row.event, row.detail, row.ip].map(csv).join(',')
    )].join('\n');
  }
  if (content) content += '\n';

  const out = args.out && args.out !== true ? path.resolve(String(args.out)) : '';
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.appendFileSync(out, content, { mode: 0o600 });
  } else {
    process.stdout.write(content);
  }
  return { ok: true, count: rows.length, format, out: out || 'stdout' };
}

function main() {
  const result = exportAudit(parseArgs(process.argv.slice(2)));
  if (process.argv.includes('--quiet')) return;
  console.error(`audit: ${result.count} evento(s) -> ${result.out}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { exportAudit, parseArgs };
