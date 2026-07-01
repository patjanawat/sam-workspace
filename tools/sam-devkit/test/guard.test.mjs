import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertDevHost } from '../lib/guard.mjs';

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
