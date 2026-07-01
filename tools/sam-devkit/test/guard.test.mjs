import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertDevHost, assertDevDbServer } from '../lib/guard.mjs';

test('accepts localhost variants', () => {
  for (const url of ['http://localhost:5000', 'http://127.0.0.1:5001', 'http://[::1]:5000']) {
    assert.doesNotThrow(() => assertDevHost(url));
  }
});

test('rejects non-dev hosts', () => {
  for (const url of ['https://sam.prod.example.com', 'http://10.0.0.5', 'https://api.company.com']) {
    assert.throws(() => assertDevHost(url), /dev host/i);
  }
});

test('rejects malformed url', () => {
  assert.throws(() => assertDevHost('not-a-url'), /invalid/i);
});

test('assertDevDbServer accepts dev servers incl. port/instance forms', () => {
  for (const s of ['localhost', '127.0.0.1', 'localhost,1433', 'localhost\\SQLEXPRESS', '(local)', '.', 'db.local', '::1', 'localhost\\SQLEXPRESS,1433']) {
    assert.doesNotThrow(() => assertDevDbServer(s));
  }
});

test('assertDevDbServer rejects remote/prod servers', () => {
  for (const s of ['sql.prod.example.com', '10.0.0.5', 'prod-sql,1433']) {
    assert.throws(() => assertDevDbServer(s), /non-dev db server/i);
  }
});

test('assertDevDbServer rejects empty', () => {
  assert.throws(() => assertDevDbServer(''), /required/i);
});

test('assertDevDbServer accepts a server listed in allowedServers (port-normalized)', () => {
  assert.doesNotThrow(() => assertDevDbServer('192.168.2.10,31433', ['192.168.2.10']));
  assert.doesNotThrow(() => assertDevDbServer('192.168.2.10,31433', ['192.168.2.10,31433']));
});

test('assertDevDbServer still rejects a non-dev server not in allowedServers', () => {
  assert.throws(() => assertDevDbServer('192.168.2.10,31433', []), /non-dev db server/i);
  assert.throws(() => assertDevDbServer('10.0.0.5', ['192.168.2.10']), /non-dev db server/i);
});
