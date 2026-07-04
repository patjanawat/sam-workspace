import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isSea, getAsset } from 'node:sea';
import { assertDevHost } from './lib/guard.mjs';
import { loadConfig, loadDbConfig, listEnvironments } from './lib/config.mjs';
import { setSapState } from './lib/sap-fixup.mjs';
import { setProposalContract } from './lib/proposal-contract.mjs';
import { searchProposals, cloneProposal } from './lib/clone-proposal.mjs';
import { inspectProposal } from './lib/inspector.mjs';
import { xrayOverview } from './lib/xray-overview.mjs';
import { createClient } from './lib/sam-client.mjs';
import { approveThrough } from './lib/approve-through.mjs';

// import.meta.url is empty in the bundled CJS (SEA) build — fall back to the exe dir.
// HERE is only used by the dev (`node server.mjs`) file-read paths; SEA uses assets + execPath.
const HERE = import.meta.url ? dirname(fileURLToPath(import.meta.url)) : dirname(process.execPath);
const PORT = process.env.PORT || 8787;

// When packaged as a single executable (SEA): index.html is an embedded asset and
// config.json is read from beside the .exe. In dev (`node server.mjs`) both sit next to this file.
const CONFIG_PATH = isSea() ? join(dirname(process.execPath), 'config.json') : join(HERE, 'config.json');

async function readIndexHtml() {
  return isSea() ? getAsset('index.html', 'utf8') : readFile(join(HERE, 'index.html'), 'utf8');
}

async function readRawConfig() {
  const txt = await readFile(CONFIG_PATH, 'utf8');
  return JSON.parse(txt);
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function handleRun(req, res) {
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

  let cfg;
  try {
    const rawCfg = await readRawConfig();
    cfg = loadConfig(rawCfg, input.env);
  } catch (e) {
    res.write(`ERROR ${e.message}\n`);
    return res.end();
  }

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

  if (module === 'proposal-contract') {
    try {
      const db = loadDbConfig(cfg);
      const r = await setProposalContract({
        db,
        proposalId: input.proposalId,
        contractNo: input.contractNo,
        productCode: input.productCode,
        log,
      });
      res.write('RESULT ' + JSON.stringify(r) + '\n');
    } catch (e) {
      const detail = e.bodyText ? ` — ${e.bodyText}` : '';
      res.write(`ERROR ${e.name || 'Error'}: ${e.message}${detail}\n`);
    }
    return res.end();
  }

  if (module === 'inspect') {
    try {
      const db = loadDbConfig(cfg);
      const r = await inspectProposal({ db, proposalId: input.proposalId, log });
      res.write('RESULT ' + JSON.stringify(r) + '\n');
    } catch (e) {
      res.write(`ERROR ${e.name || 'Error'}: ${e.message}\n`);
    }
    return res.end();
  }

  if (module === 'xray-overview') {
    try {
      const db = loadDbConfig(cfg);
      let verifyFetch = null;
      if (input.verify) {
        assertDevHost(cfg.apiBaseUrl, cfg.allowedHosts);
        const client = createClient({ baseUrl: cfg.apiBaseUrl });
        verifyFetch = async (track, id) => {
          const acct = cfg.roles?.[track]; // sam-track → sam account; sdm-track → sdm account
          if (!acct) throw new Error(`verify needs a "${track}" account in config.roles`);
          const { token } = await client.login(acct);
          return client.get(`/approval/${track}/${id}`, token);
        };
      }
      const r = await xrayOverview({ db, proposalId: input.proposalId, role: input.role, verifyFetch, log });
      res.write('RESULT ' + JSON.stringify(r) + '\n');
    } catch (e) {
      const detail = e.bodyText ? ` — ${e.bodyText}` : '';
      res.write(`ERROR ${e.name || 'Error'}: ${e.message}${detail}\n`);
    }
    return res.end();
  }

  if (module === 'clone-search') {
    try {
      const db = loadDbConfig(cfg);
      const r = await searchProposals({ db, requestNo: input.requestNo, log });
      res.write('RESULT ' + JSON.stringify(r) + '\n');
    } catch (e) {
      res.write(`ERROR ${e.name || 'Error'}: ${e.message}\n`);
    }
    return res.end();
  }

  if (module === 'clone-proposal') {
    try {
      const db = loadDbConfig(cfg);
      const r = await cloneProposal({
        db,
        sourceId: input.sourceId,
        mode: input.mode,
        newRequestNo: input.newRequestNo,
        log,
      });
      res.write('RESULT ' + JSON.stringify(r) + '\n');
    } catch (e) {
      res.write(`ERROR ${e.name || 'Error'}: ${e.message}\n`);
    }
    return res.end();
  }

  if (module !== 'approve') {
    res.write(`ERROR unknown module "${module}"\n`);
    return res.end();
  }
  if (!input.proposalId) {
    res.write('ERROR no proposalId to approve\n');
    return res.end();
  }

  try {
    assertDevHost(cfg.apiBaseUrl, cfg.allowedHosts);
    const client = createClient({ baseUrl: cfg.apiBaseUrl });
    const result = await approveThrough({ client, accounts: cfg.roles, proposalId: input.proposalId, log });
    res.write('RESULT ' + JSON.stringify(result) + '\n');
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
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/') {
      const html = await readIndexHtml();
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/config') {
      const raw = await readRawConfig();
      return send(res, 200, listEnvironments(raw)); // env names + apiBaseUrls only — never passwords
    }
    if (req.method === 'POST' && url.pathname === '/run') {
      return await handleRun(req, res);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`sam-devkit on http://localhost:${PORT}`);
});
