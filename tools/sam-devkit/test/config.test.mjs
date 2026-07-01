import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, loadDbConfig } from '../lib/config.mjs';

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

const goodDb = {
  ...good,
  db: {
    server: 'localhost',
    sam: { database: 'SamDb', user: 'sa', password: 'pw' },
    sap: { database: 'SamSapDb', user: 'sa', password: 'pw' },
  },
};

test('loadConfig passes db block through without requiring it', () => {
  assert.equal(loadConfig(good).db, undefined);        // no db block is fine
  assert.equal(loadConfig(goodDb).db.server, 'localhost');
});

test('loadDbConfig accepts a valid db block', () => {
  const db = loadDbConfig(loadConfig(goodDb));
  assert.equal(db.server, 'localhost');
  assert.equal(db.sap.database, 'SamSapDb');
});

test('loadDbConfig throws when db block missing', () => {
  assert.throws(() => loadDbConfig(loadConfig(good)), /db/);
});

test('loadDbConfig throws naming a missing sub-field', () => {
  const bad = { ...goodDb, db: { ...goodDb.db, sap: { database: 'x', user: 'y' } } };
  assert.throws(() => loadDbConfig(bad), /sap/);
});
