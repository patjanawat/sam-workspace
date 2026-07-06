import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFeVersion } from '../lib/fe-version.mjs';

const badgeHtml = (label) =>
  `<html><body><div aria-label="application-version" title="Connected to backend"><div class="inline-flex">` +
  `<span aria-hidden class="size-2"></span><span class="uppercase">Version</span>` +
  `<span class="tabular-nums overflow-hidden text-ellipsis whitespace-nowrap" title="${label}">${label}</span>` +
  `</div></div></body></html>`;

test('fetchFeVersion derives the FE URL from apiBaseUrl and extracts the version label', async () => {
  let seenUrl;
  const r = await fetchFeVersion({
    apiBaseUrl: 'http://localhost:5000/api',
    allowedHosts: [],
    fetchImpl: async (url) => { seenUrl = url; return { ok: true, text: async () => badgeHtml('1.7.15 @ 2026-07-01 10:00') }; },
  });
  assert.equal(seenUrl, 'http://localhost:5000');
  assert.equal(r.webUrl, 'http://localhost:5000');
  assert.equal(r.label, '1.7.15 @ 2026-07-01 10:00');
});

test('fetchFeVersion throws when apiBaseUrl does not end in /api', async () => {
  await assert.rejects(
    () => fetchFeVersion({ apiBaseUrl: 'http://localhost:5000', allowedHosts: [], fetchImpl: async () => ({ ok: true, text: async () => '' }) }),
    /Can't derive FE URL/,
  );
});

test('fetchFeVersion throws when the FE responds non-2xx', async () => {
  await assert.rejects(
    () => fetchFeVersion({ apiBaseUrl: 'http://localhost:5000/api', allowedHosts: [], fetchImpl: async () => ({ ok: false, status: 502, text: async () => '' }) }),
    /FE returned 502/,
  );
});

test('fetchFeVersion throws when fetch itself fails (host unreachable)', async () => {
  await assert.rejects(
    () => fetchFeVersion({ apiBaseUrl: 'http://localhost:5000/api', allowedHosts: [], fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }),
    /FE unreachable/,
  );
});

test('fetchFeVersion throws when the version badge markup is not found', async () => {
  await assert.rejects(
    () => fetchFeVersion({ apiBaseUrl: 'http://localhost:5000/api', allowedHosts: [], fetchImpl: async () => ({ ok: true, text: async () => '<html><body>no badge here</body></html>' }) }),
    /Version badge not found/,
  );
});

test('fetchFeVersion enforces the dev-host guard', async () => {
  await assert.rejects(
    () => fetchFeVersion({ apiBaseUrl: 'https://web-sam-prod.manaosoftware.com/api', allowedHosts: [], fetchImpl: async () => ({ ok: true, text: async () => '' }) }),
    /non-dev host/i,
  );
});
