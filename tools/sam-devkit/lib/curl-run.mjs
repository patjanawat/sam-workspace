import { assertDevHost } from './guard.mjs';

// Flags curl accepts that take a following value we care about.
const VALUE_FLAGS = {
  '-X': 'method', '--request': 'method',
  '-H': 'header', '--header': 'header',
  '-d': 'data', '--data': 'data', '--data-raw': 'data', '--data-binary': 'data', '--data-ascii': 'data', '--data-urlencode': 'data',
  '-b': 'cookie', '--cookie': 'cookie',
  '-u': 'user', '--user': 'user',
  '-A': 'user-agent', '--user-agent': 'user-agent',
  '-e': 'referer', '--referer': 'referer',
  '--url': 'url',
};
// Flags with no following value — e.g. copy-as-cURL from a browser always adds --compressed.
const NO_VALUE_FLAGS = new Set([
  '--compressed', '-s', '--silent', '-k', '--insecure', '-i', '--include', '-v', '--verbose',
  '-L', '--location', '-G', '--get', '-f', '--fail', '--http1.1', '--http2', '-4', '--ipv4', '-6', '--ipv6', '-N', '--no-buffer',
]);

// Scans a single-quoted token body (no escapes in shell single-quotes) starting right after
// the opening quote. Returns the literal value and the index right after the closing quote
// (or end-of-string if unterminated).
function scanSingleQuoted(input, start) {
  let i = start;
  let value = '';
  while (i < input.length && input[i] !== "'") { value += input[i]; i++; }
  return { value, next: i + 1 };
}

// Scans a double-quoted token body starting right after the opening quote. Honors the escapes
// shells give double quotes (\" \\ \$ \`) and a trailing backslash-newline (line continuation).
function scanDoubleQuoted(input, start) {
  let i = start;
  let value = '';
  while (i < input.length && input[i] !== '"') {
    if (input[i] === '\\' && '"\\$`\n'.includes(input[i + 1])) {
      if (input[i + 1] !== '\n') value += input[i + 1];
      i += 2;
      continue;
    }
    value += input[i];
    i++;
  }
  return { value, next: i + 1 };
}

// Shell-style tokenizer: single quotes are literal, double quotes allow the escapes above, and
// a bare backslash-newline outside quotes is a line continuation (removed, no token break) —
// matches how curl commands are usually pasted (multi-line with a trailing `\`).
function tokenize(input) {
  const tokens = [];
  let cur = '';
  let started = false;
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === "'") {
      const r = scanSingleQuoted(input, i + 1);
      cur += r.value; started = true; i = r.next;
      continue;
    }
    if (c === '"') {
      const r = scanDoubleQuoted(input, i + 1);
      cur += r.value; started = true; i = r.next;
      continue;
    }
    if (c === '\\' && i + 1 < input.length) {
      if (input[i + 1] !== '\n') { cur += input[i + 1]; started = true; }
      i += 2;
      continue;
    }
    if (/\s/.test(c)) {
      if (started || cur.length) { tokens.push(cur); cur = ''; started = false; }
      i++;
      continue;
    }
    cur += c; started = true; i++;
  }
  if (started || cur.length) tokens.push(cur);
  return tokens;
}

// Applies one parsed --flag/value pair onto the in-progress parse result.
function applyFlag(kind, value, ctx) {
  switch (kind) {
    case 'method':
      ctx.method = value.toUpperCase();
      break;
    case 'header': {
      const idx = value.indexOf(':');
      if (idx === -1) throw new Error(`parseCurl: malformed -H value "${value}" (expected "Name: value")`);
      ctx.headerPairs.push([value.slice(0, idx).trim(), value.slice(idx + 1).trim()]);
      break;
    }
    case 'data':
      ctx.dataParts.push(value);
      break;
    case 'cookie':
      ctx.headerPairs.push(['Cookie', value]);
      break;
    case 'user':
      ctx.headerPairs.push(['Authorization', `Basic ${Buffer.from(value, 'utf8').toString('base64')}`]);
      break;
    case 'user-agent':
      ctx.headerPairs.push(['User-Agent', value]);
      break;
    case 'referer':
      ctx.headerPairs.push(['Referer', value]);
      break;
    case 'url':
      ctx.url = value;
      break;
  }
}

// Parse a pasted curl command (e.g. "copy as cURL" from devtools/Swagger) into
// { method, url, headers, body }. Deliberately covers the common subset — -X, -H, -d/--data*,
// -b/--cookie, -u/--user, -A/--user-agent, --url — everything else is a no-op flag.
export function parseCurl(text) {
  const tokens = tokenize(text.trim());
  if (tokens[0]?.toLowerCase() === 'curl') tokens.shift();

  const ctx = { method: null, url: null, headerPairs: [], dataParts: [] };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const kind = VALUE_FLAGS[t];
    if (kind) {
      const value = tokens[++i];
      if (value === undefined) throw new Error(`parseCurl: "${t}" needs a value`);
      applyFlag(kind, value, ctx);
      continue;
    }
    if (NO_VALUE_FLAGS.has(t)) continue;
    if (t.startsWith('-')) continue; // unknown flag — ignore rather than risk eating the URL as its value
    if (!ctx.url) ctx.url = t; // first bare positional arg is the target URL
  }

  if (!ctx.url) throw new Error('parseCurl: no URL found in curl command');

  const headers = {};
  for (const [name, value] of ctx.headerPairs) headers[name] = value;

  return {
    method: ctx.method || (ctx.dataParts.length ? 'POST' : 'GET'),
    url: ctx.url,
    headers,
    body: ctx.dataParts.length ? ctx.dataParts.join('&') : undefined,
  };
}

// Execute a parsed request and report status/headers/body — same dev-host guard as every
// other module (assertDevHost against cfg.allowedHosts), so a pasted curl still can't hit prod.
export async function runCurl({ method, url, headers = {}, body, allowedHosts = [], log = () => {}, fetchImpl = globalThis.fetch }) {
  if (!url) throw new Error('runCurl: url is required');
  assertDevHost(url, allowedHosts);

  const opts = { method, headers };
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') opts.body = body;

  log(`${method} ${url}`);
  const start = Date.now();
  const res = await fetchImpl(url, opts);
  const timeMs = Date.now() - start;

  const text = await res.text();
  const resHeaders = {};
  for (const [k, v] of res.headers.entries()) resHeaders[k] = v;

  let bodyJson = null;
  try { bodyJson = JSON.parse(text); } catch { /* not JSON — bodyText carries it */ }

  const MAX = 200_000; // cap what we ship back over the /run stream
  const truncated = text.length > MAX;
  const rawBody = truncated ? text.slice(0, MAX) : text;

  log(`<- ${res.status} ${res.statusText} (${timeMs}ms)`);
  return {
    status: res.status,
    statusText: res.statusText,
    timeMs,
    headers: resHeaders,
    bodyJson,
    // Only carry bodyText for non-JSON bodies — bodyJson already has the full JSON body,
    // shipping both duplicates the payload (and doubles the size of an already-large response).
    bodyText: bodyJson === null ? rawBody : undefined,
    truncated,
  };
}
