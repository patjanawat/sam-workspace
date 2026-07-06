// FE build version for an environment — scraped from the running Next.js app's
// own page, no dedicated API endpoint exists for this.
//
// Root layout mounts <VersionFloatingBadge> unconditionally (SSR'd, always in
// the initial HTML). Its innermost span carries the version label both as its
// title attr and as text content — see
// web/web/frontend/src/components/ui/VersionBadge.tsx:88-93. We match on the
// sibling "tabular-nums" class rather than exact markup, since exact
// attribute/whitespace layout is an implementation detail of that component.
import { assertDevHost } from './guard.mjs';

const VERSION_RE = /class="[^"]*tabular-nums[^"]*"\s+title="([^"]*)"/;

// apiBaseUrl is "<host>/api" (BE, reverse-proxied); FE serves from the same
// host with no /api suffix — see .claude/docs/features/auth.md "proxy pattern".
function webUrlOf(apiBaseUrl) {
  if (!/\/api\/?$/.test(apiBaseUrl)) return null;
  return apiBaseUrl.replace(/\/api\/?$/, '');
}

export async function fetchFeVersion({ apiBaseUrl, allowedHosts, fetchImpl = globalThis.fetch }) {
  assertDevHost(apiBaseUrl, allowedHosts);
  const webUrl = webUrlOf(apiBaseUrl);
  if (!webUrl) throw new Error(`Can't derive FE URL from apiBaseUrl "${apiBaseUrl}" (expected it to end in /api)`);

  let res;
  try {
    res = await fetchImpl(webUrl);
  } catch (e) {
    throw new Error(`FE unreachable at ${webUrl}: ${e.message}`);
  }
  if (!res.ok) throw new Error(`FE returned ${res.status} at ${webUrl}`);

  const html = await res.text();
  const m = VERSION_RE.exec(html);
  if (!m) throw new Error(`Version badge not found in FE HTML at ${webUrl} (component markup may have changed)`);
  return { webUrl, label: m[1] };
}
