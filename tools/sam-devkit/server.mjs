import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertDevHost } from './lib/guard.mjs';
import { loadConfig, loadDbConfig } from './lib/config.mjs';
import { setSapState } from './lib/sap-fixup.mjs';
import { createClient } from './lib/sam-client.mjs';
import { approveThrough } from './lib/approve-through.mjs';
import { cloneProposal } from './lib/clone.mjs';
import { createProposal } from './lib/create.mjs';

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
  const module = input.module;
  if (typeof module !== 'string') {
    res.write('ERROR no module specified\n');
    return res.end();
  }

  if (module === 'sap-fixup') {
    try {
      const db = loadDbConfig(cfg);
      const r = await setSapState({
        db,
        proposalId: input.proposalId,
        sapStatus: input.sapStatus,
        contractNo: input.contractNo,
        log,
      });
      res.write('RESULT ' + JSON.stringify(r) + '\n');
    } catch (e) {
      const detail = e.bodyText ? ` — ${e.bodyText}` : '';
      res.write(`ERROR ${e.name || 'Error'}: ${e.message}${detail}\n`);
    }
    return res.end();
  }

  try {
    assertDevHost(apiBaseUrl);
    const client = createClient({ baseUrl: apiBaseUrl });

    const submitter = input.submitAs === 'sam' ? cfg.roles.sam : cfg.roles.srp;
    let proposalId = input.proposalId;

    if (module === 'create' || module === 'end-to-end-create') {
      const r = await createProposal({
        client, account: submitter, type: input.type, salesOrgId: input.salesOrgId,
        customerGroupId: input.customerGroupId, month: input.month, year: input.year,
        productIds: input.productIds, rawPayload: input.rawPayload, log,
      });
      proposalId = r.proposalId;
      res.write(`CREATED ${JSON.stringify(r)}\n`);
    } else if (module === 'clone' || module === 'end-to-end-clone') {
      const r = await cloneProposal({
        client, account: submitter, source: input.source, month: input.month, year: input.year, log,
      });
      proposalId = r.proposalId;
      res.write(`CREATED ${JSON.stringify(r)}\n`);
    }

    if (module === 'approve' || module.startsWith('end-to-end')) {
      if (!proposalId) { res.write('ERROR no proposalId to approve\n'); return res.end(); }
      const result = await approveThrough({ client, accounts: cfg.roles, proposalId, log });
      res.write('RESULT ' + JSON.stringify(result) + '\n');
    } else if (module === 'create' || module === 'clone') {
      res.write('RESULT ' + JSON.stringify({ proposalId }) + '\n');
    } else {
      res.write(`RESULT ${JSON.stringify({ error: `unknown module "${module}"` })}\n`);
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
    if (req.method === 'GET' && req.url === '/options') {
      assertDevHost(cfg.apiBaseUrl);
      const client = createClient({ baseUrl: cfg.apiBaseUrl });
      const { token } = await client.login(cfg.roles.srp);
      const options = await client.get('/requests/options', token);
      return send(res, 200, options);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`sam-devkit on http://localhost:${PORT}`);
});
