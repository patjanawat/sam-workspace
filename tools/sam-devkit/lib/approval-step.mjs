import { PROPOSAL_STATUS } from './constants.mjs';
import { detailPath } from './approve-through.mjs';

// Act on exactly one approval step (the current one), as the single configured
// dev account for that role — approve or reject with a reason. Unlike
// approveThrough (which drives the whole sam->sdm->pte->cdr chain), this stops
// after one PUT: the Inspector's "who can approve right now" panel calls this
// per click, then re-runs `inspect` to show the new state.
export async function actOnStep({ client, account, role, proposalId, isApprove, reason, log = () => {} }) {
  if (!isApprove && !(reason && reason.trim())) {
    throw new Error('Reject requires a non-empty reason.');
  }

  log(`[${role}] login`);
  const { token } = await client.login({ ...account, role });

  const detail = await client.get(detailPath(role, proposalId), token);

  if (detail.proposalStatus === PROPOSAL_STATUS.Approved || detail.proposalStatus === PROPOSAL_STATUS.Rejected) {
    const label = detail.proposalStatus === PROPOSAL_STATUS.Approved ? 'Approved' : 'Rejected';
    throw new Error(`Proposal is already ${label} — nothing to do.`);
  }
  if (!detail.canApprove) {
    throw new Error(`Not this role's turn (canApprove=false) for "${role}".`);
  }

  log(`[${role}] ${isApprove ? 'approve' : 'reject'} (rowVersion=${detail.rowVersion})`);
  const res = await client.put(`/requests/${proposalId}/approve`, token, {
    isApprove,
    rowVersion: detail.rowVersion,
    reason: isApprove ? '' : reason.trim(),
  });

  return { role, action: isApprove ? 'approved' : 'rejected', result: res };
}
