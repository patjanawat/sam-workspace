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
  return { apiBaseUrl: raw.apiBaseUrl, roles: raw.roles };
}
