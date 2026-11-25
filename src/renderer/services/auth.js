const withApi = operation => (...args) =>
  Promise.resolve().then(() => {
    const api = typeof window === 'undefined' ? null : window.lastTraining?.auth;
    if (!api) {
      throw {
        code: 'BRIDGE_MISSING',
        message: 'A ponte segura com o aplicativo não está disponível.'
      };
    }
    return operation(api, ...args);
  });

export const bootstrap = withApi(api => api.bootstrap());
export const login = withApi((api, credentials) => api.login(credentials));
export const refresh = withApi(api => api.refresh());
export const logout = withApi(api => api.logout());
export const appInfo = withApi(api => api.appInfo());
export const diagnostics = withApi(api => api.diagnostics());
export const copyDiagnostic = withApi((api, text) => api.copyDiagnostic(text));
