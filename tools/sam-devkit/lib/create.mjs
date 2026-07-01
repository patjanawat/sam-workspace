import { TYPE_TO_GROUP_ID } from './constants.mjs';
import { buildPayload } from './build-payload.mjs';

function dropEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export async function createProposal({
  client, account, type, salesOrgId, customerGroupId, month, year, productIds, rawPayload, log = () => {},
}) {
  const proposalGroupId = TYPE_TO_GROUP_ID[type];
  if (!proposalGroupId) throw new Error(`Unknown type "${type}" (expected R, S, or P)`);

  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, new Date(year, month, 0).getDate());
  const payload = rawPayload || (await buildPayload({ type, productIds, from, to }));

  log(`login as ${account.email}`);
  const { token } = await client.login(account);

  log(`create new ${type} proposal`);
  const created = await client.post('/requests', token, {
    createMode: 1, proposalGroupId, salesOrgId, customerGroupId, month, year,
  });
  const proposalId = created.id;

  log('save general-info (assigns RequestNo, Temp -> Draft)');
  const gi = await client.patch(`/proposals/${proposalId}/general-info`, token, {
    proposalGroupId, customerGroupId, customers: [], products: [], proposalFiles: [], month, year,
  });

  log('save details');
  await client.post(`/requests/${proposalId}/proposal-details`, token, dropEmpty({
    proposalId,
    rebatePayload: payload.rebatePayload,
    specialPayload: payload.specialPayload,
    accumPayload: payload.accumPayload,
  }));

  log('submit');
  await client.put(`/requests/${proposalId}/submit`, token);

  return { proposalId, requestNo: gi.requestNo };
}
