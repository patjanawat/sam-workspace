const DEV_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function assertDevHost(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid apiBaseUrl: ${baseUrl}`);
  }
  const host = url.hostname;
  const isDev = DEV_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.local');
  if (!isDev) {
    throw new Error(`Refusing to run against non-dev host "${host}". sam-devkit is dev-only.`);
  }
}

const DEV_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '(local)', '.']);

export function assertDevDbServer(server) {
  if (!server || typeof server !== 'string') throw new Error('db.server is required');
  const host = server.split(',')[0].split('\\')[0].trim().toLowerCase();
  const isDev = DEV_DB_HOSTS.has(host) || host.endsWith('.local');
  if (!isDev) {
    throw new Error(`Refusing to run against non-dev DB server "${server}". sam-devkit is dev-only.`);
  }
}
