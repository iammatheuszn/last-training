'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const MODE_LABELS = Object.freeze({
  tracking: 'Tracking',
  clicking: 'Clicking',
  flick: 'Flick',
  switching: 'Target switching',
  precision: 'Precision',
  speed: 'Speed',
  crosshair_follow: 'Crosshair follow',
  crosshair_stability: 'Crosshair hold',
  crosshair_grid: 'Crosshair grid'
});

const MODE_CATEGORIES = Object.freeze({
  tracking: 'aim',
  clicking: 'aim',
  flick: 'aim',
  switching: 'aim',
  precision: 'aim',
  speed: 'aim',
  crosshair_follow: 'crosshair',
  crosshair_stability: 'crosshair',
  crosshair_grid: 'crosshair'
});

const NEW_SESSION_COLUMNS = Object.freeze([
  ['category', "TEXT NOT NULL DEFAULT 'aim'"],
  ['tremor_ms', 'INTEGER NOT NULL DEFAULT 0'],
  ['overshoot_total', 'INTEGER NOT NULL DEFAULT 0'],
  ['target_time_total_ms', 'INTEGER NOT NULL DEFAULT 0'],
  ['target_count', 'INTEGER NOT NULL DEFAULT 0']
]);

const MAX_HISTORY = 120;
const LIST_DEFAULT = 12;
const TREND_POINTS = 24;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  mode_label TEXT NOT NULL,
  score INTEGER NOT NULL,
  accuracy INTEGER NOT NULL,
  hits INTEGER NOT NULL,
  misses INTEGER NOT NULL,
  inside_ms INTEGER NOT NULL,
  reaction_total_ms INTEGER NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_at_idx ON sessions(at DESC);

CREATE TABLE IF NOT EXISTS records (
  mode TEXT PRIMARY KEY,
  score INTEGER NOT NULL,
  accuracy INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  achieved_at TEXT NOT NULL
);
`;

let currentDb = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function integer(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clamp(Math.round(parsed), min, max);
}

function migrateSessions(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(sessions)').all().map(row => row.name));
  for (const [name, definition] of NEW_SESSION_COLUMNS) {
    if (!columns.has(name)) db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${definition}`);
  }
  db.exec(`
    UPDATE sessions SET category = CASE mode
      WHEN 'tracking' THEN 'aim'
      WHEN 'clicking' THEN 'aim'
      WHEN 'flick' THEN 'aim'
      WHEN 'switching' THEN 'aim'
      WHEN 'precision' THEN 'aim'
      WHEN 'speed' THEN 'aim'
      ELSE 'crosshair' END
  `);
}

function canonicalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const mode = typeof raw.mode === 'string' && Object.hasOwn(MODE_LABELS, raw.mode)
    ? raw.mode
    : null;
  if (!mode) return null;

  const score = integer(raw.score, 0, 100000);
  if (score === null) return null;

  const elapsedMs = integer(raw.elapsedMs, 1, 120000) ?? 30000;
  const targetCount = integer(raw.targetCount, 0, 100000) ?? 0;
  const targetTimeTotalMs = integer(raw.targetTimeTotalMs, 0, 1200000) ?? 0;
  return {
    id: randomUUID(),
    mode,
    modeLabel: MODE_LABELS[mode],
    category: MODE_CATEGORIES[mode],
    score,
    accuracy: integer(raw.accuracy, 0, 100) ?? 0,
    hits: integer(raw.hits, 0, 100000) ?? 0,
    misses: integer(raw.misses, 0, 100000) ?? 0,
    insideMs: clamp(integer(raw.insideMs, 0, 120000) ?? 0, 0, elapsedMs),
    reactionTotalMs: integer(raw.reactionTotalMs, 0, 1200000) ?? 0,
    tremorMs: integer(raw.tremorMs, 0, elapsedMs) ?? 0,
    overshootTotal: integer(raw.overshootTotal, 0, 100000) ?? 0,
    targetTimeTotalMs: clamp(targetTimeTotalMs, 0, Math.max(1, elapsedMs * 40)),
    targetCount,
    elapsedMs,
    at: new Date().toISOString()
  };
}

function resolveDb(explicit) {
  const db = explicit || currentDb;
  if (!db) throw new Error('LOCAL_DB_NOT_OPEN');
  return db;
}

function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = operation();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
    }
    throw error;
  }
}

function openLocalDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  migrateSessions(db);
  return db;
}

function setDatabase(db) {
  currentDb = db || null;
}

function getDatabase() {
  return currentDb;
}

function closeDatabase() {
  if (!currentDb) return;
  try {
    currentDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    currentDb.close();
  } finally {
    currentDb = null;
  }
}

function saveSession(raw, explicit) {
  const db = resolveDb(explicit);
  const row = canonicalize(raw);
  if (!row) return { ok: false, error: 'INVALID_SESSION' };

  transaction(db, () => {
    db.prepare(`
      INSERT INTO sessions (
        id, mode, mode_label, category, score, accuracy, hits, misses,
        inside_ms, reaction_total_ms, tremor_ms, overshoot_total,
        target_time_total_ms, target_count, elapsed_ms, at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.mode,
      row.modeLabel,
      row.category,
      row.score,
      row.accuracy,
      row.hits,
      row.misses,
      row.insideMs,
      row.reactionTotalMs,
      row.tremorMs,
      row.overshootTotal,
      row.targetTimeTotalMs,
      row.targetCount,
      row.elapsedMs,
      row.at
    );

    db.prepare(`
      INSERT INTO records (mode, score, accuracy, session_id, achieved_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(mode) DO UPDATE SET
        score = excluded.score,
        accuracy = excluded.accuracy,
        session_id = excluded.session_id,
        achieved_at = excluded.achieved_at
      WHERE excluded.score > records.score
    `).run(row.mode, row.score, row.accuracy, row.id, row.at);
  });

  return { ok: true, data: { session: row, summary: summary(db), records: records(db) } };
}

function shapeRow(row) {
  const targetCount = Number(row.target_count) || 0;
  return {
    id: row.id,
    mode: row.mode,
    modeLabel: row.mode_label,
    category: MODE_CATEGORIES[row.mode] || row.category || 'aim',
    score: Number(row.score) || 0,
    accuracy: Number(row.accuracy) || 0,
    hits: Number(row.hits) || 0,
    misses: Number(row.misses) || 0,
    insideMs: Number(row.inside_ms) || 0,
    tremorMs: Number(row.tremor_ms) || 0,
    overshoot: (Number(row.overshoot_total) || 0) / 100,
    targetCount,
    averageTargetMs: targetCount > 0
      ? Math.round((Number(row.target_time_total_ms) || 0) / targetCount)
      : 0,
    at: row.at
  };
}

function listSessions(limit, explicit) {
  const db = resolveDb(explicit);
  const parsed = Number(limit);
  const safeLimit = Number.isFinite(parsed) ? clamp(Math.round(parsed), 1, MAX_HISTORY) : LIST_DEFAULT;
  const rows = db.prepare(`
    SELECT id, mode, mode_label, category, score, accuracy, hits, misses, inside_ms,
           tremor_ms, overshoot_total, target_time_total_ms, target_count, at
    FROM sessions
    ORDER BY at DESC
    LIMIT ?
  `).all(safeLimit);
  return rows.map(shapeRow);
}

function summary(explicit) {
  const db = resolveDb(explicit);
  const row = db.prepare(`
    WITH recent AS (
      SELECT score FROM sessions ORDER BY at DESC LIMIT ?
    )
    SELECT
      COUNT(*) AS sessions,
      COALESCE(MAX(score), 0) AS best,
      COALESCE(CAST(ROUND(AVG(score)) AS INTEGER), 0) AS average,
      (SELECT MAX(at) FROM sessions) AS updatedAt
    FROM recent
  `).get(LIST_DEFAULT);
  return {
    sessions: Number(row.sessions) || 0,
    best: Number(row.best) || 0,
    average: Number(row.average) || 0,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null
  };
}

function records(explicit) {
  const db = resolveDb(explicit);
  const rows = db.prepare(`
    SELECT mode, score, accuracy, achieved_at AS achievedAt FROM records
  `).all();
  const byMode = new Map(rows.map(row => [row.mode, row]));
  return Object.entries(MODE_LABELS).map(([mode, label]) => {
    const found = byMode.get(mode);
    return {
      mode,
      label,
      category: MODE_CATEGORIES[mode],
      score: Number(found?.score) || 0,
      accuracy: Number(found?.accuracy) || 0,
      achievedAt: typeof found?.achievedAt === 'string' ? found.achievedAt : null
    };
  });
}

function averageOf(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function analytics(filter, explicit) {
  const db = resolveDb(explicit);
  const opts = filter && typeof filter === 'object' ? filter : {};
  const category = ['all', 'aim', 'crosshair'].includes(opts.category) ? opts.category : 'all';
  const mode = Object.hasOwn(MODE_LABELS, opts.mode) || opts.mode === 'all'
    ? opts.mode
    : 'all';

  const where = [];
  const params = [];
  if (category !== 'all') {
    where.push('category = ?');
    params.push(category);
  }
  if (mode !== 'all') {
    where.push('mode = ?');
    params.push(mode);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT id, mode, mode_label, category, score, accuracy, hits, misses, inside_ms,
           tremor_ms, overshoot_total, target_time_total_ms, target_count, elapsed_ms, at
    FROM sessions ${clause}
    ORDER BY at ASC
    LIMIT ?
  `).all(...params, MAX_HISTORY).map(shapeRow);

  const scores = rows.map(row => row.score);
  const withTargets = rows.filter(row => row.targetCount > 0);
  const rolling = rows.map((row, index) => {
    const window = rows.slice(Math.max(0, index - 4), index + 1);
    return averageOf(window.map(item => item.score));
  });

  const byMode = new Map();
  for (const row of rows) {
    if (!byMode.has(row.mode)) {
      byMode.set(row.mode, {
        mode: row.mode,
        label: row.modeLabel,
        category: row.category,
        sessions: 0,
        best: 0,
        scores: []
      });
    }
    const bucket = byMode.get(row.mode);
    bucket.sessions += 1;
    bucket.best = Math.max(bucket.best, row.score);
    bucket.scores.push(row.score);
  }

  return {
    category,
    mode,
    sessions: rows.length,
    best: scores.length ? Math.max(...scores) : 0,
    average: averageOf(scores),
    accuracy: averageOf(rows.map(row => row.accuracy)),
    tremorMs: averageOf(rows.map(row => row.tremorMs)),
    overshoot: rows.length
      ? Math.round((rows.reduce((sum, row) => sum + row.overshoot, 0) / rows.length) * 100) / 100
      : 0,
    averageTargetMs: withTargets.length
      ? averageOf(withTargets.map(row => row.averageTargetMs))
      : 0,
    trend: rows.slice(-TREND_POINTS).map((row, index, list) => ({
      index: rows.length - list.length + index + 1,
      id: row.id,
      at: row.at,
      mode: row.mode,
      modeLabel: row.modeLabel,
      score: row.score,
      rolling: rolling[rows.length - list.length + index]
    })),
    recent: rows.slice(-LIST_DEFAULT).reverse(),
    breakdown: [...byMode.values()]
      .map(bucket => ({
        mode: bucket.mode,
        label: bucket.label,
        category: bucket.category,
        sessions: bucket.sessions,
        best: bucket.best,
        average: averageOf(bucket.scores)
      }))
      .sort((a, b) => b.best - a.best)
  };
}

module.exports = {
  MODE_LABELS,
  MODE_CATEGORIES,
  MAX_HISTORY,
  openLocalDb,
  setDatabase,
  getDatabase,
  closeDatabase,
  saveSession,
  listSessions,
  summary,
  records,
  analytics
};
