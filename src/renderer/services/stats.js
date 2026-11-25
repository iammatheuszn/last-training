const LEGACY_HISTORY_KEY = 'lt.training.history.v1';
const LEGACY_SUMMARY_KEY = 'lt.training.summary.v1';
const MIGRATED_KEY = 'lt.stats.migrated.v1';

const withStats = operation => (...args) =>
  Promise.resolve().then(() => {
    const api = typeof window === 'undefined' ? null : window.lastTraining?.stats;
    if (!api) {
      throw {
        code: 'BRIDGE_MISSING',
        message: 'A ponte local de estatísticas não está disponível.'
      };
    }
    return operation(api, ...args);
  });

export const loadSessions = withStats(api => api.list());
export const loadSummary = withStats(api => api.summary());
export const loadRecords = withStats(api => api.records());
export const loadAnalytics = withStats((api, filter) => api.analytics(filter));
export const saveSession = withStats((api, result) => api.save(result));

let migrationPromise = null;

export function migrateLegacy() {
  if (typeof localStorage === 'undefined') {
    return Promise.resolve({ ok: false, migrated: 0 });
  }
  if (localStorage.getItem(MIGRATED_KEY)) {
    return Promise.resolve({ ok: true, migrated: 0 });
  }
  if (migrationPromise) return migrationPromise;

  migrationPromise = (async () => {
    let rows = [];
    try {
      const raw = localStorage.getItem(LEGACY_HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        rows = parsed
          .filter(row => row && typeof row === 'object' && Number.isFinite(row.score))
          .slice(-120)
          .reverse();
      }
    } catch {
      rows = [];
    }

    let migrated = 0;
    for (const row of rows) {
      try {
        const saved = await saveSession(row);
        if (saved?.ok) migrated += 1;
      } catch {
      }
    }

    try {
      localStorage.removeItem(LEGACY_HISTORY_KEY);
      localStorage.removeItem(LEGACY_SUMMARY_KEY);
      localStorage.setItem(MIGRATED_KEY, '1');
    } catch {
    }

    return { ok: true, migrated };
  })().finally(() => {
    migrationPromise = null;
  });

  return migrationPromise;
}
