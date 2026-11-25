let token = '';

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function requestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function setToken(value: string): void {
  token = value;
}

export function clearToken(): void {
  token = '';
}

export async function api<T>(route: string, body: Record<string, unknown> = {}, authenticated = true): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-request-id': requestId(),
    'cache-control': 'no-store'
  };
  if (authenticated && token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(route, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store'
  });

  const payload = await response.json().catch(() => ({
    ok: false,
    error: { code: 'INVALID_RESPONSE', message: 'Resposta inválida do servidor.' }
  }));

  if (!response.ok || !payload.ok) {
    const code = String(payload.error?.code || 'REQUEST_FAILED');
    const message = String(payload.error?.message || 'Falha na solicitação administrativa.');
    if (response.status === 401 && authenticated) clearToken();
    throw new ApiError(code, message, response.status);
  }

  return payload.data as T;
}
