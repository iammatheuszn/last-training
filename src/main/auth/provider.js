'use strict';

const { randomUUID } = require('node:crypto');
const { resolveAuthBase, resolveAuthBaseDetailed } = require('./endpoint');

const CODES = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  LICENSE_INACTIVE: 'LICENSE_INACTIVE',
  LICENSE_EXPIRED: 'LICENSE_EXPIRED',
  LICENSE_SUSPENDED: 'LICENSE_SUSPENDED',
  LICENSE_CANCELED: 'LICENSE_CANCELED',
  LICENSE_BLOCKED: 'LICENSE_BLOCKED',
  DEVICE_LIMIT: 'DEVICE_LIMIT',
  DEVICE_REVOKED: 'DEVICE_REVOKED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVER_ERROR: 'SERVER_ERROR',
  SERVER_UNAVAILABLE: 'SERVER_UNAVAILABLE',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  INSECURE_ENDPOINT: 'INSECURE_ENDPOINT'
});

const MESSAGES = Object.freeze({
  [CODES.INVALID_INPUT]: 'Revise os dados informados.',
  [CODES.INVALID_CREDENTIALS]: 'Usuário ou senha incorretos.',
  [CODES.LICENSE_INACTIVE]: 'Esta conta não possui uma licença ativa.',
  [CODES.LICENSE_EXPIRED]: 'Sua licença expirou. Renove no painel online.',
  [CODES.LICENSE_SUSPENDED]: 'Sua licença está suspensa. Verifique no painel online.',
  [CODES.LICENSE_CANCELED]: 'Esta licença foi cancelada.',
  [CODES.LICENSE_BLOCKED]: 'Esta conta está bloqueada.',
  [CODES.DEVICE_LIMIT]: 'Limite de dispositivos atingido. Libere um dispositivo no painel online.',
  [CODES.DEVICE_REVOKED]: 'Este dispositivo foi revogado. Use outro computador ou libere o acesso no painel.',
  [CODES.SESSION_REVOKED]: 'Sessão revogada. Entre novamente.',
  [CODES.SESSION_EXPIRED]: 'Sessão expirada. Entre novamente.',
  [CODES.RATE_LIMITED]: 'Muitas tentativas. Aguarde um instante antes de continuar.',
  [CODES.SERVER_ERROR]: 'O serviço de autenticação recusou a solicitação.',
  [CODES.SERVER_UNAVAILABLE]: 'Não foi possível contatar o serviço de autenticação.',
  [CODES.INVALID_RESPONSE]: 'O servidor respondeu com dados inválidos.',
  [CODES.NOT_CONFIGURED]: 'Configure LT_AUTH_API_BASE_URL com HTTPS ou execute start-last-training.bat.',
  [CODES.INSECURE_ENDPOINT]: 'O serviço exige uma conexão HTTPS.'
});

class AuthError extends Error {
  constructor(code, message, retryAfter = 0, detail = {}) {
    super(message || MESSAGES[code] || 'Falha na autenticação.');
    this.name = 'AuthError';
    this.code = code;
    this.retryAfter = retryAfter;
    this.httpStatus = Number(detail.httpStatus) || 0;
    this.serverCode = typeof detail.serverCode === 'string' ? detail.serverCode : '';
    this.requestId = typeof detail.requestId === 'string' ? detail.requestId : '';
  }
}

const apiBase = () => resolveAuthBase();

function publicEndpoint(raw) {
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function mapServerCode(code) {
  const known = {
    INVALID_CREDENTIALS: CODES.INVALID_CREDENTIALS,
    ACCOUNT_BLOCKED: CODES.LICENSE_BLOCKED,
    LICENSE_INACTIVE: CODES.LICENSE_INACTIVE,
    LICENSE_EXPIRED: CODES.LICENSE_EXPIRED,
    LICENSE_SUSPENDED: CODES.LICENSE_SUSPENDED,
    LICENSE_CANCELED: CODES.LICENSE_CANCELED,
    DEVICE_LIMIT: CODES.DEVICE_LIMIT,
    DEVICE_REVOKED: CODES.DEVICE_REVOKED,
    SESSION_REVOKED: CODES.SESSION_REVOKED,
    SESSION_EXPIRED: CODES.SESSION_EXPIRED,
    TOKEN_EXPIRED: CODES.SESSION_EXPIRED,
    TOKEN_INVALID: CODES.SESSION_REVOKED,
    RATE_LIMITED: CODES.RATE_LIMITED,
    INVALID_INPUT: CODES.INVALID_INPUT,
    DEVICE_INVALID: CODES.INVALID_INPUT,
    DEVICE_NOT_FOUND: CODES.INVALID_INPUT,
    SESSION_NOT_FOUND: CODES.INVALID_INPUT,
    CANNOT_REVOKE_CURRENT: CODES.INVALID_INPUT,
    FORBIDDEN: CODES.LICENSE_BLOCKED,
    INTERNAL_ERROR: CODES.SERVER_ERROR,
    REQUEST_ID_INVALID: CODES.INVALID_RESPONSE,
    ORIGIN_BLOCKED: CODES.INVALID_RESPONSE
  };
  return known[code] || CODES.SERVER_UNAVAILABLE;
}

function describeError(error) {
  if (!(error instanceof AuthError)) return null;
  return {
    code: error.code,
    message: error.message,
    httpStatus: error.httpStatus,
    serverCode: error.serverCode || error.code,
    requestId: error.requestId,
    retryAfter: error.retryAfter
  };
}

function normalizeSession(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AuthError(CODES.INVALID_RESPONSE);
  }
  const token = typeof data.token === 'string' ? data.token : '';
  const refreshToken = typeof data.refreshToken === 'string' ? data.refreshToken : '';
  const license = data.license && typeof data.license === 'object' ? data.license : null;
  if (!token || token.length > 8192 || !license || typeof license.status !== 'string') {
    throw new AuthError(CODES.INVALID_RESPONSE);
  }
  if (refreshToken && (refreshToken.length < 20 || refreshToken.length > 512)) {
    throw new AuthError(CODES.INVALID_RESPONSE);
  }
  const account = data.account && typeof data.account === 'object' ? data.account : {};
  return {
    token,
    refreshToken,
    account: {
      id: String(account.id ?? '').slice(0, 128),
      display: String(account.display ?? account.email ?? '').slice(0, 254),
      email: String(account.email ?? '').slice(0, 254)
    },
    license: {
      status: String(license.status).slice(0, 32),
      plan: String(license.plan ?? '').slice(0, 64),
      expiresAt: typeof license.expiresAt === 'string' ? license.expiresAt : null,
      features: Array.isArray(license.features)
        ? license.features.filter(item => typeof item === 'string').slice(0, 64)
        : []
    },
    expiresAt: Number(data.expiresAt) || 0
  };
}

async function request(pathname, body, bearer) {
  const base = apiBase();
  if (!base) throw new AuthError(CODES.NOT_CONFIGURED);
  if (new URL(base).protocol !== 'https:') throw new AuthError(CODES.INSECURE_ENDPOINT);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-request-id': randomUUID()
    };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    const response = await fetch(new URL(pathname, `${base}/`), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const retryAfter = Number(response.headers.get('retry-after')) || 0;
    if (!response.ok) {
      let code = CODES.SERVER_UNAVAILABLE;
      let serverCode = '';
      try {
        const failure = await response.json();
        if (failure?.error?.code) {
          serverCode = String(failure.error.code).slice(0, 64);
          code = mapServerCode(serverCode);
        }
      } catch {
      }
      throw new AuthError(code, undefined, retryAfter, {
        httpStatus: response.status,
        serverCode: serverCode || code,
        requestId: response.headers.get('x-request-id') || ''
      });
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new AuthError(CODES.INVALID_RESPONSE);
    }
    if (data?.ok !== true) throw new AuthError(CODES.INVALID_RESPONSE);
    return data.data;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (error.name === 'AbortError') throw new AuthError(CODES.SERVER_UNAVAILABLE);
    throw new AuthError(CODES.SERVER_UNAVAILABLE);
  } finally {
    clearTimeout(timeout);
  }
}

async function post(pathname, body, bearer) {
  return normalizeSession(await request(pathname, body, bearer));
}

async function diagnose() {
  const resolved = resolveAuthBaseDetailed();
  const shown = publicEndpoint(resolved.base);
  let protocol = '';
  try {
    protocol = resolved.base ? new URL(resolved.base).protocol.replace(':', '') : '';
  } catch {
    protocol = 'invalid';
  }

  const endpoint = {
    configured: Boolean(resolved.base),
    source: resolved.source,
    sourceLabel: resolved.sourceLabel,
    base: shown,
    protocol,
    https: protocol === 'https'
  };
  const checks = [{
    id: 'endpoint',
    label: 'Endpoint HTTPS',
    status: endpoint.configured && endpoint.https ? 'ok' : 'fail',
    detail: !endpoint.configured
      ? 'Nenhum endpoint configurado.'
      : endpoint.https
        ? `${endpoint.sourceLabel} → ${shown}`
        : `Protocolo ${protocol || 'inválido'} recusado.`
  }];

  if (!endpoint.configured) {
    return {
      status: 'not_configured',
      code: CODES.NOT_CONFIGURED,
      endpoint,
      checks,
      latencyMs: 0,
      httpStatus: 0,
      message: MESSAGES[CODES.NOT_CONFIGURED],
      generatedAt: new Date().toISOString()
    };
  }
  if (!endpoint.https) {
    return {
      status: 'insecure',
      code: CODES.INSECURE_ENDPOINT,
      endpoint,
      checks,
      latencyMs: 0,
      httpStatus: 0,
      message: MESSAGES[CODES.INSECURE_ENDPOINT],
      generatedAt: new Date().toISOString()
    };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let httpStatus = 0;
  let latencyMs = 0;
  let healthy = false;
  let detail = '';
  try {
    const response = await fetch(new URL('/health', `${resolved.base}/`), {
      method: 'GET',
      headers: { accept: 'application/json', 'x-request-id': randomUUID() },
      signal: controller.signal
    });
    httpStatus = response.status;
    latencyMs = Date.now() - started;
    try {
      const body = await response.json();
      healthy = response.ok && body?.ok === true;
    } catch {
      healthy = false;
    }
    detail = healthy
      ? `/health respondeu ${httpStatus} em ${latencyMs} ms.`
      : `/health respondeu ${httpStatus} com corpo inválido.`;
  } catch (error) {
    latencyMs = Date.now() - started;
    detail = error?.name === 'AbortError'
      ? 'Tempo limite ao contatar /health (5 s).'
      : 'Falha de TLS, DNS ou conexão com /health.';
  } finally {
    clearTimeout(timeout);
  }

  checks.push({
    id: 'reachability',
    label: 'Backend /health',
    status: healthy ? 'ok' : 'fail',
    detail
  });

  return {
    status: healthy ? 'ready' : 'unavailable',
    code: healthy ? '' : CODES.SERVER_UNAVAILABLE,
    endpoint,
    checks,
    latencyMs,
    httpStatus,
    message: healthy ? 'Serviço de autenticação alcançável.' : MESSAGES[CODES.SERVER_UNAVAILABLE],
    generatedAt: new Date().toISOString()
  };
}

const provider = {
  configured: () => Boolean(apiBase()),
  diagnostics: diagnose,
  authenticate: ({ identity, password, device }) =>
    post('/v1/auth/login', { identity, password, device }),
  validateSession: token => post('/v1/auth/validate', { token }, token),
  checkLicense: token => post('/v1/license/check', { token }, token),
  refreshSession: ({ refreshToken }) => post('/v1/auth/refresh', { refreshToken }),
  revokeSession: ({ token, refreshToken }) =>
    request('/v1/auth/logout', { refreshToken }, token),
  accountSummary: token => request('/v1/account/summary', {}, token),
  accountDevices: token => request('/v1/account/devices', {}, token),
  accountSessions: token => request('/v1/account/sessions', {}, token),
  revokeAccountDevice: ({ token, deviceId }) =>
    request('/v1/account/devices/revoke', { deviceId }, token),
  revokeAccountSession: ({ token, sessionId }) =>
    request('/v1/account/sessions/revoke', { sessionId }, token),
  revokeOtherAccountSessions: token =>
    request('/v1/account/sessions/revoke-others', {}, token)
};

module.exports = {
  provider,
  AuthError,
  CODES,
  MESSAGES,
  mapServerCode,
  describeError,
  diagnose
};
