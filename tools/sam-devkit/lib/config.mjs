const REQUIRED_ROLES = ['srp', 'sam', 'sdm', 'pte', 'cdr'];

export function loadConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('config.json: not an object');
  if (!raw.apiBaseUrl) throw new Error('config.json: missing apiBaseUrl');
  if (!raw.roles) throw new Error('config.json: missing roles');
  for (const r of REQUIRED_ROLES) {
    const a = raw.roles[r];
    if (!a || !a.email || !a.password) {
      throw new Error(`config.json: role "${r}" needs { email, password }`);
    }
  }
  const allowedHosts = raw.allowedHosts ?? [];
  if (!Array.isArray(allowedHosts) || allowedHosts.some((h) => typeof h !== 'string')) {
    throw new Error('config.json: allowedHosts must be an array of strings');
  }
  return { apiBaseUrl: raw.apiBaseUrl, roles: raw.roles, db: raw.db, allowedHosts };
}

export function loadDbConfig(cfg) {
  const db = cfg && cfg.db;
  if (!db || typeof db !== 'object') throw new Error('config.json: missing "db" block (required for sap-fixup)');
  if (!db.server) throw new Error('config.json: db.server is required');
  for (const key of ['sam', 'sap']) {
    const d = db[key];
    if (!d || !d.database || !d.user || !d.password) {
      throw new Error(`config.json: db.${key} needs { database, user, password }`);
    }
  }
  const allowedServers = db.allowedServers ?? [];
  if (!Array.isArray(allowedServers) || allowedServers.some((s) => typeof s !== 'string')) {
    throw new Error('config.json: db.allowedServers must be an array of strings');
  }
  return { server: db.server, sam: db.sam, sap: db.sap, allowedServers };
}
