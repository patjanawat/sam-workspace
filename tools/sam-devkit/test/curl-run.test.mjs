import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCurl, runCurl } from '../lib/curl-run.mjs';

test('GET with -H headers (the swagger "copy as cURL" shape)', () => {
  const r = parseCurl(`curl -X 'GET' \\
  'https://web-sam-qa.manaosoftware.com/api/requests/request-number-options?ProposalGroupId=1' \\
  -H 'accept: application/json' \\
  -H 'Authorization: Bearer abc.def.ghi'`);
  assert.equal(r.method, 'GET');
  assert.equal(r.url, 'https://web-sam-qa.manaosoftware.com/api/requests/request-number-options?ProposalGroupId=1');
  assert.deepEqual(r.headers, { accept: 'application/json', Authorization: 'Bearer abc.def.ghi' });
  assert.equal(r.body, undefined);
});

test('no -X and a -d body defaults method to POST', () => {
  const r = parseCurl(`curl 'https://api.example.com/things' -H 'Content-Type: application/json' -d '{"a":1}'`);
  assert.equal(r.method, 'POST');
  assert.equal(r.body, '{"a":1}');
});

test('no -X and no body defaults method to GET', () => {
  const r = parseCurl(`curl 'https://api.example.com/things'`);
  assert.equal(r.method, 'GET');
});

test('multiple -d parts join with &', () => {
  const r = parseCurl(`curl 'https://api.example.com' -d 'a=1' -d 'b=2'`);
  assert.equal(r.body, 'a=1&b=2');
});

test('double-quoted values with escaped quotes', () => {
  const r = parseCurl(`curl "https://api.example.com" -H "X-Note: say \\"hi\\""`);
  assert.deepEqual(r.headers, { 'X-Note': 'say "hi"' });
});

test('unknown boolean flags (e.g. --compressed) are ignored, not eaten as the URL', () => {
  const r = parseCurl(`curl --compressed -X GET 'https://api.example.com/x'`);
  assert.equal(r.url, 'https://api.example.com/x');
});

test('-u builds a Basic Authorization header', () => {
  const r = parseCurl(`curl -u 'bob:secret' 'https://api.example.com'`);
  assert.equal(r.headers.Authorization, `Basic ${Buffer.from('bob:secret').toString('base64')}`);
});

test('missing URL throws', () => {
  assert.throws(() => parseCurl(`curl -X GET -H 'accept: application/json'`), /no URL found/);
});

test('malformed -H value throws', () => {
  assert.throws(() => parseCurl(`curl 'https://api.example.com' -H 'not-a-header'`), /malformed -H value/);
});

function fakeFetch(status, statusText, headers, bodyText) {
  return async () => ({
    status,
    statusText,
    headers: new Map(Object.entries(headers)),
    text: async () => bodyText,
  });
}

test('runCurl reports status/headers/parsed JSON body', async () => {
  const r = await runCurl({
    method: 'GET',
    url: 'http://localhost:5000/x',
    headers: {},
    allowedHosts: [],
    fetchImpl: fakeFetch(200, 'OK', { 'content-type': 'application/json' }, '{"ok":true}'),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.headers, { 'content-type': 'application/json' });
  assert.deepEqual(r.bodyJson, { ok: true });
  assert.equal(r.truncated, false);
});

test('runCurl falls back to bodyText when the body is not JSON', async () => {
  const r = await runCurl({
    method: 'GET',
    url: 'http://localhost:5000/x',
    headers: {},
    allowedHosts: [],
    fetchImpl: fakeFetch(500, 'Internal Server Error', {}, 'boom'),
  });
  assert.equal(r.bodyJson, null);
  assert.equal(r.bodyText, 'boom');
});

test('runCurl refuses a non-dev host', async () => {
  await assert.rejects(
    runCurl({ method: 'GET', url: 'https://prod.example.com/x', headers: {}, allowedHosts: [], fetchImpl: fakeFetch(200, 'OK', {}, '') }),
    /Refusing to run against non-dev host/,
  );
});

test('runCurl drops the body on GET (fetch rejects GET+body)', async () => {
  let seenOpts;
  const fetchImpl = async (url, opts) => { seenOpts = opts; return { status: 200, statusText: 'OK', headers: new Map(), text: async () => '' }; };
  await runCurl({ method: 'GET', url: 'http://localhost:5000/x', headers: {}, body: 'x=1', allowedHosts: [], fetchImpl });
  assert.equal(seenOpts.body, undefined);
});
