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
