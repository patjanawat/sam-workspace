const REQUIRED_ROLES = ['srp', 'sam', 'sdm', 'pte', 'cdr'];

function validateProfile(p, label) {
  if (!p || typeof p !== 'object') throw new Error(`config.json: ${label} not an object`);
  if (!p.apiBaseUrl) throw new Error(`config.json: ${label} missing apiBaseUrl`);
  if (!p.roles) throw new Error(`config.json: ${label} missing roles`);
  for (const r of REQUIRED_ROLES) {
    const a = p.roles[r];
    if (!a || !a.email || !a.password) throw new Error(`config.json: ${label} role "${r}" needs { email, password }`);
  }
  const allowedHosts = p.allowedHosts ?? [];
  if (!Array.isArray(allowedHosts) || allowedHosts.some((h) => typeof h !== 'string')) {
    throw new Error(`config.json: ${label} allowedHosts must be an array of strings`);
  }
}

// role -> email only (never password) — lets the UI recognize "this row is the configured account".
function roleEmailsOf(roles) {
  const out = {};
  for (const r of REQUIRED_ROLES) out[r] = roles?.[r]?.email ?? '';
  return out;
}

// Non-secret env summary for the UI dropdown (names + apiBaseUrl + role emails only — never passwords).
export function listEnvironments(raw) {
  if (raw && raw.environments && typeof raw.environments === 'object') {
    const names = Object.keys(raw.environments);
    if (!names.length) throw new Error('config.json: environments is empty');
    const defaultEnv = raw.defaultEnv && names.includes(raw.defaultEnv) ? raw.defaultEnv : names[0];
    return {
      envNames: names,
      defaultEnv,
      environments: names.map((n) => ({
        name: n,
        apiBaseUrl: raw.environments[n]?.apiBaseUrl ?? '',
        roleEmails: roleEmailsOf(raw.environments[n]?.roles),
      })),
    };
  }
  return {
    envNames: ['default'],
    defaultEnv: 'default',
    environments: [{ name: 'default', apiBaseUrl: raw?.apiBaseUrl ?? '', roleEmails: roleEmailsOf(raw?.roles) }],
  };
}

// Resolve one environment to a flat profile the rest of the app already understands.
// The profile's OWN host is auto-added to allowedHosts (configuring an env = the explicit opt-in),
// so the dev-host guard passes for configured envs while unconfigured hosts stay blocked.
export function loadConfig(raw, envName) {
  if (!raw || typeof raw !== 'object') throw new Error('config.json: not an object');
  let profile, env;
  if (raw.environments && typeof raw.environments === 'object') {
    const names = Object.keys(raw.environments);
    if (!names.length) throw new Error('config.json: environments is empty');
    env = envName || raw.defaultEnv || names[0];
    profile = raw.environments[env];
    if (!profile) throw new Error(`config.json: unknown environment "${env}"`);
    validateProfile(profile, `environment "${env}"`);
  } else {
    env = 'default';
    validateProfile(raw, 'config');
    profile = raw;
  }
  const allowedHosts = [...(profile.allowedHosts ?? [])];
  try { allowedHosts.push(new URL(profile.apiBaseUrl).hostname); } catch { /* invalid URL surfaces later in assertDevHost */ }
  return { apiBaseUrl: profile.apiBaseUrl, roles: profile.roles, db: profile.db, allowedHosts, env };
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
