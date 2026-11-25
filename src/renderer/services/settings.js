const LEGACY_KEY = 'lt.customization.v1';
const MIGRATED_KEY = 'lt.settings.migrated.v1';
const NUMERIC_KEYS = [
  'sensitivity',
  'targetSize',
  'crosshairOpacity',
  'feedback'
];

const withBridge = (group, operation) => (...args) =>
  Promise.resolve().then(() => {
    const api = typeof window === 'undefined' ? null : window.lastTraining?.[group];
    if (!api) {
      throw {
        code: 'BRIDGE_MISSING',
        message: 'A ponte segura de configuração não está disponível.'
      };
    }
    return operation(api, ...args);
  });

export const getSettings = withBridge('settings', api => api.get());
export const putSettings = withBridge('settings', (api, patch) => api.put(patch));
export const overlayState = withBridge('overlay', api => api.state());
export const getOverlayState = overlayState;

let cache = null;
let ready = null;
let migration = null;

function migrateLegacyOnce() {
  if (typeof localStorage === 'undefined') return Promise.resolve(false);
  if (localStorage.getItem(MIGRATED_KEY)) return Promise.resolve(false);
  if (migration) return migration;

  migration = (async () => {
    let legacy = {};
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) legacy = parsed;
    } catch {
      legacy = {};
    }

    const patch = {};
    for (const key of NUMERIC_KEYS) {
      const value = Number(legacy[key]);
      if (Number.isFinite(value)) patch[key] = Math.max(0, Math.min(100, Math.round(value)));
    }

    try {
      if (Object.keys(patch).length) await putSettings(patch);
      localStorage.removeItem(LEGACY_KEY);
      localStorage.setItem(MIGRATED_KEY, '1');
    } catch {
    }
    return true;
  })().finally(() => {
    migration = null;
  });

  return migration;
}

export function loadSettings() {
  if (!ready) {
    ready = (async () => {
      await migrateLegacyOnce();
      const result = await getSettings();
      cache = result?.ok ? result.data : null;
      return cache;
    })();
  }
  return ready;
}

export async function saveSettings(patch) {
  const result = await putSettings(patch);
  if (result?.ok && result.data) cache = { ...(cache || {}), ...result.data };
  return result;
}
