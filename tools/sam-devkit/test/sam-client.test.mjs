import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, LoginError, ApiError } from '../lib/sam-client.mjs';

function fakeFetch(routes) {
  // routes: array of { match(method,url,body) => bool, status, json }
  return async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    const r = routes.find((x) => x.match(method, url, body));
    if (!r) throw new Error(`no fake route for ${method} ${url}`);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => (r.json === undefined ? '' : JSON.stringify(r.json)),
    };
  };
}

test('login posts credentials and returns token', async () => {
  let seen;
  const client = createClient({
    baseUrl: 'http://localhost:5000',
    fetchImpl: fakeFetch([
      { match: (m, u, b) => { seen = { m, u, b }; return m === 'POST' && u.endsWith('/login'); },
        status: 200, json: { token: 'jwt-abc', roleCode: 'srp' } },
    ]),
  });
  const res = await client.login({ email: 'a@b.com', password: 'pw' });
  assert.equal(res.token, 'jwt-abc');
  assert.equal(res.roleCode, 'srp');
  assert.deepEqual(seen.b, { email: 'a@b.com', password: 'pw' });
});

test('login throws LoginError with status on 401', async () => {
  const client = createClient({
    baseUrl: 'http://localhost:5000',
    fetchImpl: fakeFetch([{ match: () => true, status: 401, json: { error: 'Unauthorized' } }]),
  });
  await assert.rejects(() => client.login({ email: 'a', password: 'b' }), (e) => {
    assert.ok(e instanceof LoginError);
    assert.equal(e.status, 401);
    assert.match(e.bodyText, /Unauthorized/);
    return true;
  });
});

test('get adds bearer token and parses json', async () => {
  let auth;
  const client = createClient({
    baseUrl: 'http://localhost:5000',
    fetchImpl: async (url, opts) => { auth = opts.headers.Authorization; return { ok: true, status: 200, text: async () => JSON.stringify({ rowVersion: 'AB12' }) }; },
  });
  const out = await client.get('/approval/sam/1', 'jwt-xyz');
  assert.equal(auth, 'Bearer jwt-xyz');
  assert.equal(out.rowVersion, 'AB12');
});

test('non-2xx throws ApiError with bodyText', async () => {
  const client = createClient({
    baseUrl: 'http://localhost:5000',
    fetchImpl: fakeFetch([{ match: () => true, status: 400, json: { message: 'Invalid proposal year or month.' } }]),
  });
  await assert.rejects(() => client.post('/requests', 'tok', {}), (e) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 400);
    assert.match(e.bodyText, /Invalid proposal year/);
    return true;
  });
});

test('empty 200 body parses to {}', async () => {
  const client = createClient({
    baseUrl: 'http://localhost:5000',
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '' }),
  });
  const out = await client.put('/requests/1/submit', 'tok');
  assert.deepEqual(out, {});
});
