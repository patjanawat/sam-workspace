import { APPROVAL_ROLES, PROPOSAL_STATUS } from './constants.mjs';

export function detailPath(role, id) {
  return role === 'sam' ? `/approval/sam/${id}` : `/approval/sdm/${id}`;
}

export async function approveThrough({ client, accounts, proposalId, log = () => {} }) {
  const steps = [];
  let cdrJobId = null;
  let finalStatus = PROPOSAL_STATUS.Pending;

  for (const role of APPROVAL_ROLES) {
    const acct = accounts[role];
    if (!acct) throw new Error(`Missing account for role "${role}" in config.`);

    log(`[${role}] login`);
    const { token } = await client.login({ ...acct, role });

    const detail = await client.get(detailPath(role, proposalId), token);
    finalStatus = detail.proposalStatus;

    if (finalStatus === PROPOSAL_STATUS.Approved || finalStatus === PROPOSAL_STATUS.Rejected) {
      log(`[${role}] proposal already ${finalStatus === PROPOSAL_STATUS.Approved ? 'Approved' : 'Rejected'} — stop`);
      steps.push({ role, action: 'stopped', status: finalStatus });
      break;
    }

    if (!detail.canApprove) {
      log(`[${role}] not this role's turn (canApprove=false) — skip`);
      steps.push({ role, action: 'skipped', status: finalStatus });
      continue;
    }

    log(`[${role}] approve (rowVersion=${detail.rowVersion})`);
    const res = await client.put(`/requests/${proposalId}/approve`, token, {
      isApprove: true,
      rowVersion: detail.rowVersion,
    });
    steps.push({ role, action: 'approved', status: finalStatus });

    if (role === 'cdr') {
      cdrJobId = res.jobId ?? null;
      log(`[cdr] approval enqueued — jobId=${cdrJobId} (SAP sync runs async)`);
    }
  }

  return { finalStatus, steps, cdrJobId };
}
