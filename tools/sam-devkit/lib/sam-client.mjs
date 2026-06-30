export class ApiError extends Error {
  constructor(message, status, bodyText) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.bodyText = bodyText;
  }
}

export class LoginError extends ApiError {
  constructor(message, status, bodyText) {
    super(message, status, bodyText);
    this.name = 'LoginError';
  }
}

export function createClient({ baseUrl, fetchImpl = globalThis.fetch }) {
  const base = baseUrl.replace(/\/$/, '');

  async function raw(method, path, { token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new ApiError(`${method} ${path} -> ${res.status}`, res.status, text);
    }
    return text ? JSON.parse(text) : {};
  }

  return {
    async login({ email, password }) {
      try {
        return await raw('POST', '/login', { body: { email, password } });
      } catch (e) {
        if (e instanceof ApiError) throw new LoginError(e.message, e.status, e.bodyText);
        throw e;
      }
    },
    req: raw,
    get: (path, token) => raw('GET', path, { token }),
    post: (path, token, body) => raw('POST', path, { token, body }),
    put: (path, token, body) => raw('PUT', path, { token, body }),
    patch: (path, token, body) => raw('PATCH', path, { token, body }),
  };
}
