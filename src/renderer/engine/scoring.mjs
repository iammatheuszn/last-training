export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function accuracyOf(hits, attempts) {
  if (!Number.isFinite(attempts) || attempts <= 0) return 0;
  return clamp((hits / attempts) * 100, 0, 100);
}

const CONTINUOUS = new Set(['tracking', 'crosshair_follow', 'crosshair_stability']);

export function scoreFor(mode, sample) {
  const hits = Math.max(0, Number(sample.hits) || 0);
  const misses = Math.max(0, Number(sample.misses) || 0);
  const insideMs = Math.max(0, Number(sample.insideMs) || 0);
  const elapsedMs = Math.max(1, Number(sample.elapsedMs) || 1);
  const reactionMs = Math.max(0, Number(sample.reactionTotalMs) || 0);

  if (CONTINUOUS.has(mode)) {
    return Math.round((insideMs / elapsedMs) * 10000);
  }
  if (mode === 'flick') {
    const average = hits > 0 ? reactionMs / hits : 2000;
    return Math.max(0, Math.round(hits * 100 - misses * 25 - average / 8));
  }
  if (mode === 'precision') {
    return Math.max(0, Math.round(hits * 150 - misses * 35));
  }
  if (mode === 'speed') {
    return Math.max(0, Math.round(hits * 90 - misses * 20));
  }
  if (mode === 'crosshair_grid') {
    return Math.max(0, Math.round(hits * 350));
  }
  return Math.max(0, Math.round(hits * 100 - misses * 25));
}

export function summarize(history) {
  const rows = Array.isArray(history) ? history.filter(row => Number.isFinite(row?.score)) : [];
  if (!rows.length) return { sessions: 0, best: 0, average: 0 };
  const scores = rows.map(row => row.score);
  return {
    sessions: rows.length,
    best: Math.max(...scores),
    average: Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
  };
}
