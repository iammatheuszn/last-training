const withApi = operation => (...args) =>
  Promise.resolve().then(() => {
    const api = typeof window === 'undefined' ? null : window.lastTraining?.system;
    if (!api) return { checked: false, reason: 'bridge-missing' };
    return operation(api, ...args);
  });

export const checkUpdate = withApi(api => api.checkUpdate());
export const installUpdate = withApi(api => api.installUpdate());
export const integrity = withApi(api => api.integrity());
export const openExternal = withApi((api, url) => api.openExternal(url));
