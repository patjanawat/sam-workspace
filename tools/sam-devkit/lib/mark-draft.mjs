// Flip a Temp(0) proposal to Draft(1) directly in the DB.
//
// There is no dedicated API for this: the real backend only does it as a side
// effect of PATCH /proposals/{id}/general-info, which needs the full
// general-info payload (RequestNo, CustomerGroupId, Month/Year, Products,
// Customers, Files, ...) — too risky to reconstruct from devkit, one wrong
// field could clobber real data. A direct column flip matches SAP fixup /
// Clone / unlock's existing "direct DB, dev-host guarded" philosophy instead.
import { assertDevDbServer } from './guard.mjs';
import { runSql } from './db.mjs';

const GUID_RE = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;
const esc = (v) => String(v).replace(/'/g, "''");

export async function markProposalDraft({ db, proposalId, run = runSql, log = () => {} }) {
  if (!GUID_RE.test(proposalId || '')) throw new Error(`Invalid proposalId (must be GUID): ${proposalId}`);
  assertDevDbServer(db.server, db.allowedServers);
  const sam = { server: db.server, ...db.sam };
  const id = esc(proposalId);
  log(`[kit] mark draft ${proposalId}`);
  const out = await run({
    ...sam,
    sql: `SET NOCOUNT ON; UPDATE dbo.Proposal SET ProposalStatus = 1 WHERE Id='${id}' AND ProposalStatus = 0; SELECT @@ROWCOUNT;`,
  });
  const rows = Number(String(out).trim()) || 0;
  log(`[kit]   rows affected: ${rows}`);
  return { rows };
}
