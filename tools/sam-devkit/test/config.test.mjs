import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, loadDbConfig, listEnvironments } from '../lib/config.mjs';

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

test('loadDbConfig defaults allowedServers to [] when absent', () => {
  const db = loadDbConfig(loadConfig(goodDb));
  assert.deepEqual(db.allowedServers, []);
});

test('loadDbConfig passes through allowedServers', () => {
  const withAllow = { ...goodDb, db: { ...goodDb.db, allowedServers: ['192.168.2.10'] } };
  assert.deepEqual(loadDbConfig(withAllow).allowedServers, ['192.168.2.10']);
});

test('loadDbConfig rejects non-array / non-string allowedServers', () => {
  assert.throws(() => loadDbConfig({ ...goodDb, db: { ...goodDb.db, allowedServers: 'x' } }), /allowedServers/);
  assert.throws(() => loadDbConfig({ ...goodDb, db: { ...goodDb.db, allowedServers: [1] } }), /allowedServers/);
});

// --- environments (named profiles) ---

const envCfg = {
  defaultEnv: 'local',
  environments: {
    local: { apiBaseUrl: 'http://localhost:5000', roles: good.roles },
    qa: { apiBaseUrl: 'https://web-sam-qa.manaosoftware.com/api', roles: good.roles },
  },
};

test('environments config resolves the default env', () => {
  const cfg = loadConfig(envCfg);
  assert.equal(cfg.apiBaseUrl, 'http://localhost:5000');
  assert.equal(cfg.roles.cdr.email, 'a');
  assert.equal(cfg.env, 'local');
});

test('loadConfig(envCfg, "qa") resolves the named env', () => {
  const cfg = loadConfig(envCfg, 'qa');
  assert.equal(cfg.apiBaseUrl, 'https://web-sam-qa.manaosoftware.com/api');
  assert.equal(cfg.env, 'qa');
});

test('loadConfig(envCfg, "qa") auto-adds the qa host to allowedHosts', () => {
  const cfg = loadConfig(envCfg, 'qa');
  assert.ok(cfg.allowedHosts.includes('web-sam-qa.manaosoftware.com'));
});

test('unknown env throws', () => {
  assert.throws(() => loadConfig(envCfg, 'nope'), /unknown environment/);
});

test('empty environments object throws', () => {
  assert.throws(() => loadConfig({ environments: {} }), /environments is empty/);
});

test('missing role inside an env profile throws naming the env + role', () => {
  const bad = {
    environments: {
      qa: { apiBaseUrl: 'https://qa.example.com', roles: { ...good.roles } },
    },
  };
  delete bad.environments.qa.roles.cdr;
  assert.throws(() => loadConfig(bad, 'qa'), /environment "qa".*cdr/);
});

test('listEnvironments returns env names + apiBaseUrls + role emails and no password fields', () => {
  const list = listEnvironments(envCfg);
  assert.deepEqual(list.envNames, ['local', 'qa']);
  assert.equal(list.defaultEnv, 'local');
  assert.deepEqual(list.environments, [
    { name: 'local', apiBaseUrl: 'http://localhost:5000', roleEmails: { srp: 'a', sam: 'a', sdm: 'a', pte: 'a', cdr: 'a' } },
    { name: 'qa', apiBaseUrl: 'https://web-sam-qa.manaosoftware.com/api', roleEmails: { srp: 'a', sam: 'a', sdm: 'a', pte: 'a', cdr: 'a' } },
  ]);
  const json = JSON.stringify(list);
  assert.ok(!json.includes('password'));
});

test('listEnvironments on a flat config returns a single "default" env', () => {
  const list = listEnvironments(good);
  assert.deepEqual(list.envNames, ['default']);
  assert.equal(list.defaultEnv, 'default');
  assert.deepEqual(list.environments, [
    { name: 'default', apiBaseUrl: 'http://localhost:5000', roleEmails: { srp: 'a', sam: 'a', sdm: 'a', pte: 'a', cdr: 'a' } },
  ]);
});

test('listEnvironments defaults roleEmails to empty strings when roles are absent', () => {
  const list = listEnvironments({ apiBaseUrl: 'http://localhost:5000' });
  assert.deepEqual(list.environments[0].roleEmails, { srp: '', sam: '', sdm: '', pte: '', cdr: '' });
});

test('flat config (no environments) still resolves as before', () => {
  const cfg = loadConfig(good);
  assert.equal(cfg.apiBaseUrl, 'http://localhost:5000');
  assert.equal(cfg.env, 'default');
});
