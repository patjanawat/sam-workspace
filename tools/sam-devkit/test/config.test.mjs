import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../lib/config.mjs';

const good = {
  apiBaseUrl: 'http://localhost:5000',
  roles: {
    srp: { email: 'a', password: 'b' }, sam: { email: 'a', password: 'b' },
    sdm: { email: 'a', password: 'b' }, pte: { email: 'a', password: 'b' },
    cdr: { email: 'a', password: 'b' },
  },
};

test('valid config passes through', () => {
  const cfg = loadConfig(good);
  assert.equal(cfg.apiBaseUrl, 'http://localhost:5000');
  assert.equal(cfg.roles.cdr.email, 'a');
});

test('missing role throws naming the role', () => {
  const bad = { ...good, roles: { ...good.roles } };
  delete bad.roles.cdr;
  assert.throws(() => loadConfig(bad), /cdr/);
});

test('missing apiBaseUrl throws', () => {
  const bad = { ...good }; delete bad.apiBaseUrl;
  assert.throws(() => loadConfig(bad), /apiBaseUrl/);
});

test('missing roles object throws naming roles', () => {
  const bad = { apiBaseUrl: 'http://localhost:5000' };
  assert.throws(() => loadConfig(bad), /roles/);
});
