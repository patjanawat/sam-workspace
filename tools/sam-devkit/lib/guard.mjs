const DEV_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function assertDevHost(baseUrl, allowedHosts = []) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid apiBaseUrl: ${baseUrl}`);
  }
  const host = url.hostname.toLowerCase();
  const allowed = (Array.isArray(allowedHosts) ? allowedHosts : []).map((h) => String(h).toLowerCase());
  const isDev = DEV_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.local') || allowed.includes(host);
  if (!isDev) {
    throw new Error(`Refusing to run against non-dev host "${host}". Add it to config.json "allowedHosts" if this is a dev/QA server.`);
  }
}

const DEV_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '(local)', '.']);

export function assertDevDbServer(server, allowedServers = []) {
  if (!server || typeof server !== 'string') throw new Error('db.server is required');
  const norm = (s) => String(s).split(',')[0].split('\\')[0].trim().toLowerCase();
  const host = norm(server);
  const allowed = (Array.isArray(allowedServers) ? allowedServers : []).map(norm);
  const isDev = DEV_DB_HOSTS.has(host) || host.endsWith('.local') || allowed.includes(host);
  if (!isDev) {
    throw new Error(`Refusing to run against non-dev DB server "${server}". sam-devkit is dev-only.`);
  }
}
