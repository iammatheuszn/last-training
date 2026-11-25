'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  openLocalDb,
  saveSession,
  listSessions,
  summary,
  records,
  analytics
} = require('../storage/localDb');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-local-db-'));
const db = openLocalDb(path.join(dir, 'training.sqlite'));

const sample = score => ({
  id: 'spoofed-id',
  mode: 'clicking',
  modeLabel: 'SQL injection',
  score,
  accuracy: 90,
  hits: 9,
  misses: 1,
  insideMs: 0,
  reactionTotalMs: 1200,
  tremorMs: 640,
  overshootTotal: 1800,
  targetTimeTotalMs: 9000,
  targetCount: 10,
  elapsedMs: 30000,
  at: '2000-01-01T00:00:00.000Z'
});

test('sessão é canônica, com id e hora gerados no Main', () => {
  const saved = saveSession(sample(900), db);
  assert.equal(saved.ok, true);
  assert.notEqual(saved.data.session.id, 'spoofed-id');
  assert.notEqual(saved.data.session.at, '2000-01-01T00:00:00.000Z');
  assert.equal(saved.data.session.modeLabel, 'Clicking');
  assert.equal(saved.data.session.mode, 'clicking');
});

test('lista, resumo e recordes leem o banco local', () => {
  const rows = listSessions(12, db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].score, 900);

  const sum = summary(db);
  assert.equal(sum.sessions, 1);
  assert.equal(sum.best, 900);
  assert.equal(sum.average, 900);

  const all = records(db);
  assert.equal(all.length, 9);
  assert.equal(all.find(row => row.mode === 'clicking').score, 900);
  assert.equal(all.find(row => row.mode === 'flick').score, 0);
});

test('recorde só troca quando a pontuação é maior', () => {
  saveSession(sample(1000), db);
  saveSession(sample(100), db);
  const clicking = records(db).find(row => row.mode === 'clicking');
  assert.equal(clicking.score, 1000);
  assert.equal(summary(db).sessions, 3);
});

test('payload inválido falha fechado e números são limitados', () => {
  assert.equal(saveSession({ mode: 'admin', score: 10 }, db).ok, false);
  assert.equal(saveSession({ mode: 'clicking', score: 'dez' }, db).ok, false);

  const saved = saveSession({
    mode: 'flick',
    score: 1e9,
    accuracy: 500,
    hits: -4,
    elapsedMs: 99999999,
    insideMs: 99999999
  }, db);
  assert.equal(saved.ok, true);
  assert.equal(saved.data.session.score, 100000);
  assert.equal(saved.data.session.accuracy, 100);
  assert.equal(saved.data.session.hits, 0);
  assert.equal(saved.data.session.elapsedMs, 120000);
  assert.equal(saved.data.session.insideMs, 120000);
});

test('lista respeita limite externo', () => {
  assert.ok(listSessions(999, db).length <= 120);
  assert.equal(listSessions(0, db).length, 1);
  assert.equal(listSessions(undefined, db).length, 4);
});

test('análise filtra categoria e modalidade, com tendência e métricas fundas', () => {
  const result = analytics({ category: 'aim', mode: 'clicking' }, db);
  assert.equal(result.category, 'aim');
  assert.equal(result.mode, 'clicking');
  assert.equal(result.sessions, 3);
  assert.equal(result.best, 1000);
  assert.equal(result.averageTargetMs, 900);
  assert.equal(result.tremorMs, 640);
  assert.equal(result.overshoot, 18);
  assert.equal(result.trend.length, 3);
  assert.equal(result.breakdown.length, 1);
  assert.equal(result.recent[0].score, 100);

  assert.equal(analytics({ category: 'crosshair' }, db).sessions, 0);
  assert.equal(analytics({ mode: 'flick' }, db).sessions, 1);
});

test('banco legado recebe colunas de categoria e métricas sem perder sessões', () => {
  const legacyPath = path.join(dir, 'legacy.sqlite');
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, mode TEXT NOT NULL, mode_label TEXT NOT NULL,
      score INTEGER NOT NULL, accuracy INTEGER NOT NULL, hits INTEGER NOT NULL,
      misses INTEGER NOT NULL, inside_ms INTEGER NOT NULL,
      reaction_total_ms INTEGER NOT NULL, elapsed_ms INTEGER NOT NULL, at TEXT NOT NULL
    );
    INSERT INTO sessions VALUES (
      'legacy', 'crosshair_stability', 'Crosshair hold', 500, 80, 80, 20,
      24000, 0, 30000, '2025-01-01T00:00:00.000Z'
    );
  `);
  legacy.close();

  const upgraded = openLocalDb(legacyPath);
  const rows = listSessions(12, upgraded);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, 'crosshair');
  assert.equal(rows[0].tremorMs, 0);
  assert.equal(analytics({ category: 'crosshair' }, upgraded).sessions, 1);
  upgraded.close();
});

test.after(() => {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
  } catch {
  }
});
