import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertDevHost } from './lib/guard.mjs';
import { loadConfig } from './lib/config.mjs';
import { createClient } from './lib/sam-client.mjs';
import { approveThrough } from './lib/approve-through.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;

async function readConfig() {
  const txt = await readFile(join(HERE, 'config.json'), 'utf8');
  return loadConfig(JSON.parse(txt));
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function handleRun(req, res, cfg) {
  let raw = '';
  for await (const chunk of req) raw += chunk;

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  const log = (m) => res.write(m + '\n');

  let input;
  try {
    input = JSON.parse(raw || '{}');
  } catch {
    res.write('ERROR Bad request body (invalid JSON)\n');
    return res.end();
  }
  const apiBaseUrl = input.apiBaseUrl || cfg.apiBaseUrl;

  try {
    assertDevHost(apiBaseUrl);
    const client = createClient({ baseUrl: apiBaseUrl });

    if (input.module === 'approve') {
      const result = await approveThrough({
        client, accounts: cfg.roles, proposalId: input.proposalId, log,
      });
      res.write('RESULT ' + JSON.stringify(result) + '\n');
    } else {
      res.write(`RESULT ${JSON.stringify({ error: `unknown module "${input.module}"` })}\n`);
    }
  } catch (e) {
    // LoginError / ApiError carry .status and .bodyText for a useful message
    const detail = e.bodyText ? ` — ${e.bodyText}` : '';
    res.write(`ERROR ${e.name || 'Error'}: ${e.message}${detail}\n`);
  } finally {
    res.end();
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const cfg = await readConfig();
    if (req.method === 'GET' && req.url === '/') {
      const html = await readFile(join(HERE, 'index.html'), 'utf8');
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && req.url === '/config') {
      return send(res, 200, { apiBaseUrl: cfg.apiBaseUrl }); // never expose passwords
    }
    if (req.method === 'POST' && req.url === '/run') {
      return await handleRun(req, res, cfg);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`sam-devkit on http://localhost:${PORT}`);
});
