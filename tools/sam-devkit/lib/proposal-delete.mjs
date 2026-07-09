// Delete a Draft(1) proposal via the real API.
//
// DELETE /requests/{id} is already server-gated to ProposalStatus==Draft (a
// mismatched status is a silent no-op, not an error) and has no ownership
// check, so any logged-in role account can call it. devkit only holds one
// login per role, so it picks the first role configured in config.json
// rather than hardcoding one.
const GUID_RE = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;

export const DELETE_ROLE_ORDER = ['srp', 'sam', 'sdm', 'pte', 'cdr'];

export async function deleteProposal({ client, accounts, proposalId, log = () => {} }) {
  if (!GUID_RE.test(proposalId || '')) throw new Error(`Invalid proposalId (must be GUID): ${proposalId}`);
  const role = DELETE_ROLE_ORDER.find((r) => accounts && accounts[r]);
  if (!role) throw new Error(`No configured account for any role in config.roles (${DELETE_ROLE_ORDER.join(', ')})`);

  log(`[${role}] login`);
  const { token } = await client.login({ ...accounts[role], role });

  log(`[${role}] delete ${proposalId}`);
  await client.delete(`/requests/${proposalId}`, token);

  return { role, proposalId, deleted: true };
}
