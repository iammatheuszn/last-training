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

export const accountSummary = withApi(api => api.accountSummary());
export const accountDevices = withApi(api => api.accountDevices());
export const accountSessions = withApi(api => api.accountSessions());
export const revokeAccountDevice = withApi((api, deviceId) => api.revokeAccountDevice(deviceId));
export const revokeAccountSession = withApi((api, sessionId) => api.revokeAccountSession(sessionId));
export const revokeOtherAccountSessions = withApi(api => api.revokeOtherAccountSessions());
